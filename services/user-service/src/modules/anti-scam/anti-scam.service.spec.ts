import { BadRequestException, ConflictException } from '@nestjs/common';
import { AntiScamService } from './anti-scam.service';
import { AntiScamConfig } from './anti-scam.config';
import { ScammerRecord } from './entities/scammer-record.entity';
import { ScamReport } from './entities/scam-report.entity';
import { ScamReportStatus, ScammerStatus } from './enums/anti-scam.enum';

/**
 * Minimal in-memory stand-ins for the two TypeORM repositories. They implement
 * only the methods AntiScamService touches, with just enough query semantics
 * (unique-ish lookups + count with a Not(REJECTED) filter) to exercise the
 * dedup / threshold logic without a real DB.
 */
class FakeRecordRepo {
  rows: ScammerRecord[] = [];
  private seq = 1;

  create(data: Partial<ScammerRecord>): ScammerRecord {
    return { screenshotFileIds: [], ...data } as ScammerRecord;
  }

  async save(entity: ScammerRecord): Promise<ScammerRecord> {
    if (!entity.id) {
      entity.id = `rec-${this.seq++}`;
      this.rows.push(entity);
    } else if (!this.rows.includes(entity)) {
      this.rows.push(entity);
    }
    return entity;
  }

  async findOne({ where }: { where: Partial<ScammerRecord> }): Promise<ScammerRecord | null> {
    return (
      this.rows.find((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      ) ?? null
    );
  }
}

class FakeReportRepo {
  rows: ScamReport[] = [];
  private seq = 1;

  create(data: Partial<ScamReport>): ScamReport {
    return { ...data } as ScamReport;
  }

  async save(entity: ScamReport): Promise<ScamReport> {
    if (!entity.id) {
      entity.id = `rep-${this.seq++}`;
      this.rows.push(entity);
    }
    return entity;
  }

  async findOne({ where }: { where: Partial<ScamReport> }): Promise<ScamReport | null> {
    return (
      this.rows.find((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      ) ?? null
    );
  }

  // Only used with { scammerRecordId, status: Not(REJECTED) } → count active reporters.
  async count({ where }: { where: any }): Promise<number> {
    return this.rows.filter(
      (r) =>
        r.scammerRecordId === where.scammerRecordId &&
        r.status !== ScamReportStatus.REJECTED,
    ).length;
  }

  async update(criteria: any, patch: Partial<ScamReport>): Promise<void> {
    for (const r of this.rows) {
      if (
        r.scammerRecordId === criteria.scammerRecordId &&
        r.status === criteria.status
      ) {
        Object.assign(r, patch);
      }
    }
  }
}

function makeConfig(threshold: number): AntiScamConfig {
  return {
    autoConfirmReporterThreshold: threshold,
    minScreenshots: 1,
    maxScreenshots: 10,
  } as unknown as AntiScamConfig;
}

describe('AntiScamService', () => {
  let recordRepo: FakeRecordRepo;
  let reportRepo: FakeReportRepo;
  let publisher: { postEvidenceForRecord: jest.Mock };
  let service: AntiScamService;

  const baseReport = (overrides: Partial<{
    reporterUserId: string;
    reporterTelegramId: number;
    reason: string;
    screenshotFileIds: string[];
    targetTelegramId: number;
  }> = {}) => ({
    reporterUserId: overrides.reporterUserId ?? 'user-1',
    reporterTelegramId: overrides.reporterTelegramId ?? 111,
    target: { telegramId: overrides.targetTelegramId ?? 999, username: 'scammer' },
    reason: overrides.reason ?? 'Took the money and disappeared',
    screenshotFileIds: overrides.screenshotFileIds ?? ['file-1'],
  });

  const build = (threshold = 3) => {
    recordRepo = new FakeRecordRepo();
    reportRepo = new FakeReportRepo();
    publisher = { postEvidenceForRecord: jest.fn(async () => 'https://t.me/evi/1') };
    const adminRepo = { findOne: jest.fn(async () => null) };
    service = new AntiScamService(
      recordRepo as any,
      reportRepo as any,
      adminRepo as any,
      makeConfig(threshold),
      publisher as any,
    );
  };

  beforeEach(() => build());

  it('rejects a complaint without screenshots (proofs mandatory)', async () => {
    await expect(
      service.fileReport(baseReport({ screenshotFileIds: [] })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects self-reports', async () => {
    await expect(
      service.fileReport(baseReport({ reporterTelegramId: 999, targetTelegramId: 999 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a first valid complaint and creates a REPORTED record', async () => {
    const { record, autoConfirmed, isNewRecord } = await service.fileReport(baseReport());
    expect(record.status).toBe(ScammerStatus.REPORTED);
    expect(record.distinctReporterCount).toBe(1);
    expect(autoConfirmed).toBe(false);
    expect(isNewRecord).toBe(true);
  });

  it('blocks the same reporter reporting the same target twice', async () => {
    await service.fileReport(baseReport());
    await expect(service.fileReport(baseReport())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('blocks an identical complaint text from a different reporter (anti copy-paste)', async () => {
    await service.fileReport(baseReport({ reporterUserId: 'user-1', reporterTelegramId: 111 }));
    await expect(
      service.fileReport(
        baseReport({ reporterUserId: 'user-2', reporterTelegramId: 222 }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('auto-confirms once the distinct-reporter threshold is reached', async () => {
    await service.fileReport(
      baseReport({ reporterUserId: 'u1', reporterTelegramId: 1, reason: 'reason A' }),
    );
    await service.fileReport(
      baseReport({ reporterUserId: 'u2', reporterTelegramId: 2, reason: 'reason B' }),
    );
    const third = await service.fileReport(
      baseReport({ reporterUserId: 'u3', reporterTelegramId: 3, reason: 'reason C' }),
    );

    expect(third.autoConfirmed).toBe(true);
    expect(third.record.status).toBe(ScammerStatus.CONFIRMED);
    expect(publisher.postEvidenceForRecord).toHaveBeenCalledTimes(1);
  });

  it('checkAccount returns scammer for a confirmed record and clean for unknown', async () => {
    build(1); // threshold 1 → single report confirms
    await service.fileReport(baseReport());

    const scammer = await service.checkAccount({ telegramId: 999 });
    expect(scammer.kind).toBe('scammer');

    const clean = await service.checkAccount({ telegramId: 12345 });
    expect(clean.kind).toBe('clean');
  });

  it('manual confirmation flags the record and posts evidence', async () => {
    const { record } = await service.fileReport(baseReport());
    const confirmed = await service.confirmScammer(record.id, 'moderator-1');

    expect(confirmed.status).toBe(ScammerStatus.CONFIRMED);
    expect(confirmed.moderatedById).toBe('moderator-1');
    expect(publisher.postEvidenceForRecord).toHaveBeenCalledWith(record.id);
  });
});
