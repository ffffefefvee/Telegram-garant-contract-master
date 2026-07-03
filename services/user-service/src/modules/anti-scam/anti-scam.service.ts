import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Not, Repository } from 'typeorm';
import { AntiScamConfig } from './anti-scam.config';
import { AntiScamPublisherService } from './anti-scam-publisher.service';
import { ScammerRecord } from './entities/scammer-record.entity';
import { ScamReport } from './entities/scam-report.entity';
import { AdminProfile } from '../admin/entities/admin-profile.entity';
import { Role } from '../admin/enums/role.enum';
import {
  ScamConfirmationSource,
  ScamReportStatus,
  ScammerStatus,
} from './enums/anti-scam.enum';

/** Identifies the account being checked/reported. */
export interface ScamTarget {
  telegramId?: number | null;
  username?: string | null;
  displayName?: string | null;
}

export interface FileReportInput {
  reporterUserId: string;
  reporterTelegramId?: number | null;
  target: ScamTarget;
  reason: string;
  screenshotFileIds: string[];
}

export type ScamVerdictKind = 'clean' | 'reported' | 'scammer';

export interface ScamVerdict {
  kind: ScamVerdictKind;
  record: ScammerRecord | null;
  /** Deep-link to the DB channel entry, when published. */
  dbChannelLink: string | null;
}

/**
 * Core anti-scam logic: account checks, complaint intake with anti-spam
 * dedup + mandatory screenshots, hybrid confirmation (auto reporter threshold +
 * manual moderation), and moderation transitions.
 */
@Injectable()
export class AntiScamService {
  private readonly logger = new Logger(AntiScamService.name);

  constructor(
    @InjectRepository(ScammerRecord)
    private readonly recordRepo: Repository<ScammerRecord>,
    @InjectRepository(ScamReport)
    private readonly reportRepo: Repository<ScamReport>,
    @InjectRepository(AdminProfile)
    private readonly adminProfileRepo: Repository<AdminProfile>,
    private readonly antiScamConfig: AntiScamConfig,
    private readonly publisher: AntiScamPublisherService,
  ) {}

  /**
   * Whether a platform user may moderate scam reports (ADMIN / SUPER_ADMIN with
   * an active admin profile). Used to gate the in-bot moderation buttons.
   */
  async isModerator(userId: string): Promise<boolean> {
    const profile = await this.adminProfileRepo.findOne({ where: { userId } });
    return (
      !!profile &&
      profile.isActive &&
      (profile.role === Role.ADMIN || profile.role === Role.SUPER_ADMIN)
    );
  }

  // ─────────────────────────────── Check ────────────────────────────────

  /**
   * Look up an account and return a verdict. Resolves by Telegram id first,
   * then by username.
   */
  async checkAccount(target: ScamTarget): Promise<ScamVerdict> {
    const record = await this.findRecord(target);
    if (!record) {
      return { kind: 'clean', record: null, dbChannelLink: null };
    }

    if (
      record.status === ScammerStatus.CONFIRMED ||
      record.status === ScammerStatus.PUBLISHED
    ) {
      return {
        kind: 'scammer',
        record,
        dbChannelLink: this.buildDbChannelLink(record),
      };
    }

    if (record.status === ScammerStatus.REPORTED) {
      return { kind: 'reported', record, dbChannelLink: null };
    }

    // REJECTED → treated as clean.
    return { kind: 'clean', record: null, dbChannelLink: null };
  }

  // ─────────────────────────────── Report ───────────────────────────────

  /**
   * File a complaint. Enforces: mandatory screenshots, no self-reports, per-user
   * uniqueness, and global content-hash uniqueness (anti copy-paste flooding).
   * Auto-confirms + posts evidence when the distinct-reporter threshold is hit.
   */
  async fileReport(input: FileReportInput): Promise<{
    report: ScamReport;
    record: ScammerRecord;
    autoConfirmed: boolean;
    isNewRecord: boolean;
  }> {
    this.validateScreenshots(input.screenshotFileIds);

    const reason = (input.reason ?? '').trim();
    if (reason.length < 3) {
      throw new BadRequestException('Reason is too short');
    }

    if (
      input.target.telegramId != null &&
      input.reporterTelegramId != null &&
      Number(input.target.telegramId) === Number(input.reporterTelegramId)
    ) {
      throw new BadRequestException('You cannot report yourself');
    }

    const contentHash = this.hashReason(reason);

    // Global anti-flood: identical complaint text is rejected everywhere.
    const duplicateContent = await this.reportRepo.findOne({
      where: { contentHash },
    });
    if (duplicateContent) {
      throw new ConflictException('This exact complaint text was already submitted');
    }

    const recordBefore = await this.findRecord(input.target);
    const isNewRecord = !recordBefore;
    const record = await this.findOrCreateRecord(input.target);

    // One complaint per reporter per target.
    const existing = await this.reportRepo.findOne({
      where: { scammerRecordId: record.id, reporterUserId: input.reporterUserId },
    });
    if (existing) {
      throw new ConflictException('You have already reported this account');
    }

    const report = this.reportRepo.create({
      scammerRecordId: record.id,
      reporterUserId: input.reporterUserId,
      reporterTelegramId: input.reporterTelegramId ?? null,
      reason,
      contentHash,
      screenshotFileIds: input.screenshotFileIds,
      status: ScamReportStatus.PENDING,
    });
    await this.reportRepo.save(report);

    // Refresh last-known identity hints for the DB-channel entry.
    this.applyIdentityHints(record, input.target);
    record.distinctReporterCount = await this.countDistinctReporters(record.id);

    let autoConfirmed = false;
    if (
      record.status === ScammerStatus.REPORTED &&
      record.distinctReporterCount >= this.antiScamConfig.autoConfirmReporterThreshold
    ) {
      this.markConfirmed(record, ScamConfirmationSource.AUTO_THRESHOLD, null);
      autoConfirmed = true;
    }

    await this.recordRepo.save(record);

    if (autoConfirmed) {
      await this.publisher.postEvidenceForRecord(record.id);
    }

    return { report, record, autoConfirmed, isNewRecord };
  }

  // ───────────────────────────── Moderation ─────────────────────────────

  /** Reports awaiting manual moderation, newest first. */
  async listPendingReports(limit = 50): Promise<ScamReport[]> {
    return this.reportRepo.find({
      where: { status: ScamReportStatus.PENDING },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Scammer records awaiting a moderator decision. */
  async listReportedRecords(limit = 50): Promise<ScammerRecord[]> {
    return this.recordRepo.find({
      where: { status: ScammerStatus.REPORTED },
      order: { distinctReporterCount: 'DESC', updatedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Manually confirm a scammer (variant 1). Approves pending reports, flags the
   * record CONFIRMED, and posts the evidence message.
   */
  async confirmScammer(recordId: string, moderatorUserId: string): Promise<ScammerRecord> {
    const record = await this.getRecordOrThrow(recordId);
    if (
      record.status === ScammerStatus.CONFIRMED ||
      record.status === ScammerStatus.PUBLISHED
    ) {
      return record;
    }

    await this.reportRepo.update(
      { scammerRecordId: record.id, status: ScamReportStatus.PENDING },
      { status: ScamReportStatus.APPROVED, moderatedById: moderatorUserId, moderatedAt: new Date() },
    );

    record.distinctReporterCount = await this.countDistinctReporters(record.id);
    this.markConfirmed(record, ScamConfirmationSource.MANUAL, moderatorUserId);
    await this.recordRepo.save(record);

    await this.publisher.postEvidenceForRecord(record.id);
    return record;
  }

  /** Reject an entire scammer record (dismisses the accusation). */
  async rejectScammer(recordId: string, moderatorUserId: string): Promise<ScammerRecord> {
    const record = await this.getRecordOrThrow(recordId);
    record.status = ScammerStatus.REJECTED;
    record.moderatedById = moderatorUserId;
    await this.recordRepo.save(record);

    await this.reportRepo.update(
      { scammerRecordId: record.id, status: ScamReportStatus.PENDING },
      { status: ScamReportStatus.REJECTED, moderatedById: moderatorUserId, moderatedAt: new Date() },
    );
    return record;
  }

  /** Reject a single report and recompute the distinct-reporter count. */
  async rejectReport(reportId: string, moderatorUserId: string): Promise<ScamReport> {
    const report = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    report.status = ScamReportStatus.REJECTED;
    report.moderatedById = moderatorUserId;
    report.moderatedAt = new Date();
    await this.reportRepo.save(report);

    const record = await this.recordRepo.findOne({ where: { id: report.scammerRecordId } });
    if (record && record.status === ScammerStatus.REPORTED) {
      record.distinctReporterCount = await this.countDistinctReporters(record.id);
      await this.recordRepo.save(record);
    }
    return report;
  }

  /** Confirmed scammers not yet posted to the DB channel (for the scheduler). */
  async findConfirmedUnpublished(limit: number): Promise<ScammerRecord[]> {
    return this.recordRepo.find({
      where: { status: ScammerStatus.CONFIRMED },
      order: { confirmedAt: 'ASC' },
      take: limit,
    });
  }

  // ─────────────────────────────── Helpers ──────────────────────────────

  private validateScreenshots(fileIds: string[]): void {
    const count = Array.isArray(fileIds) ? fileIds.length : 0;
    if (count < this.antiScamConfig.minScreenshots) {
      throw new BadRequestException(
        `At least ${this.antiScamConfig.minScreenshots} screenshot(s) required`,
      );
    }
    if (count > this.antiScamConfig.maxScreenshots) {
      throw new BadRequestException(
        `At most ${this.antiScamConfig.maxScreenshots} screenshots allowed`,
      );
    }
  }

  private markConfirmed(
    record: ScammerRecord,
    source: ScamConfirmationSource,
    moderatorUserId: string | null,
  ): void {
    record.status = ScammerStatus.CONFIRMED;
    record.confirmationSource = source;
    record.confirmedAt = new Date();
    record.moderatedById = moderatorUserId;
  }

  private async findRecord(target: ScamTarget): Promise<ScammerRecord | null> {
    if (target.telegramId != null) {
      const byId = await this.recordRepo.findOne({
        where: { targetTelegramId: Number(target.telegramId) },
      });
      if (byId) return byId;
    }
    if (target.username) {
      return this.recordRepo.findOne({
        where: { targetUsername: this.normalizeUsername(target.username) },
      });
    }
    return null;
  }

  private async findOrCreateRecord(target: ScamTarget): Promise<ScammerRecord> {
    if (target.telegramId == null) {
      // Records are keyed by Telegram id; without it we can't reliably dedupe.
      throw new BadRequestException('Target Telegram id is required to file a report');
    }

    const existing = await this.recordRepo.findOne({
      where: { targetTelegramId: Number(target.telegramId) },
    });
    if (existing) {
      return existing;
    }

    const created = this.recordRepo.create({
      targetTelegramId: Number(target.telegramId),
      targetUsername: target.username ? this.normalizeUsername(target.username) : null,
      targetDisplayName: target.displayName ?? null,
      status: ScammerStatus.REPORTED,
      distinctReporterCount: 0,
    });
    return this.recordRepo.save(created);
  }

  private applyIdentityHints(record: ScammerRecord, target: ScamTarget): void {
    if (target.username) {
      record.targetUsername = this.normalizeUsername(target.username);
    }
    if (target.displayName) {
      record.targetDisplayName = target.displayName;
    }
  }

  private async countDistinctReporters(recordId: string): Promise<number> {
    return this.reportRepo.count({
      where: { scammerRecordId: recordId, status: Not(ScamReportStatus.REJECTED) },
    });
  }

  private async getRecordOrThrow(recordId: string): Promise<ScammerRecord> {
    const record = await this.recordRepo.findOne({ where: { id: recordId } });
    if (!record) {
      throw new NotFoundException('Scammer record not found');
    }
    return record;
  }

  private buildDbChannelLink(record: ScammerRecord): string | null {
    if (!record.dbChannelMessageId) {
      return null;
    }
    const username = this.antiScamConfig.dbChannelUsername;
    if (username) {
      return `https://t.me/${username.replace('@', '')}/${record.dbChannelMessageId}`;
    }
    const raw = this.antiScamConfig.dbChannelId ?? '';
    const normalized = raw.replace('-100', '');
    return `https://t.me/c/${normalized}/${record.dbChannelMessageId}`;
  }

  private normalizeUsername(username: string): string {
    return username.trim().replace(/^@/, '').toLowerCase();
  }

  private hashReason(reason: string): string {
    const normalized = reason.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized).digest('hex');
  }
}
