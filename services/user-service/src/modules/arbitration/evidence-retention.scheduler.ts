import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, IsNull, LessThanOrEqual, Repository } from "typeorm";
import { AuditLogService } from "../ops/audit-log.service";
import { EvidenceFileManifest } from "./entities/evidence-file-manifest.entity";
import {
  EVIDENCE_OBJECT_STORAGE,
  EvidenceObjectStorage,
} from "./evidence-pipeline.ports";

const MAX_ATTEMPTS = 10;

@Injectable()
export class EvidenceRetentionScheduler {
  private readonly logger = new Logger(EvidenceRetentionScheduler.name);

  constructor(
    @InjectRepository(EvidenceFileManifest)
    private readonly manifests: Repository<EvidenceFileManifest>,
    @Inject(EVIDENCE_OBJECT_STORAGE)
    private readonly storage: EvidenceObjectStorage,
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (this.config.get("EVIDENCE_PIPELINE_ENABLED") !== "true") return;
    const now = new Date();
    const candidates = await this.manifests.find({
      where: [
        {
          retentionUntil: LessThanOrEqual(now),
          deletedAt: IsNull(),
          deletionDeadLetterAt: IsNull(),
          deletionNextAttemptAt: IsNull(),
        },
        {
          retentionUntil: LessThanOrEqual(now),
          deletedAt: IsNull(),
          deletionDeadLetterAt: IsNull(),
          deletionNextAttemptAt: LessThanOrEqual(now),
        },
      ],
      order: { retentionUntil: "ASC" },
      take: 100,
    });
    for (const manifest of candidates) await this.deleteExpired(manifest, now);
  }

  private async deleteExpired(
    manifest: EvidenceFileManifest,
    now: Date,
  ): Promise<void> {
    try {
      await this.storage.delete(manifest.storageKey);
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(EvidenceFileManifest);
        const locked = await repo.findOne({
          where: { id: manifest.id },
          lock: { mode: "pessimistic_write" },
        });
        if (!locked || locked.deletedAt) return;
        locked.deletedAt = now;
        locked.deletionReason = "retention_expired";
        locked.deletionAttempts += 1;
        locked.deletionNextAttemptAt = null;
        locked.deletionLastError = null;
        await repo.save(locked);
        await this.audit.writeRequired({
          actorRole: "system",
          aggregateType: "evidence",
          aggregateId: locked.evidenceId,
          action: "EVIDENCE_RETENTION_DELETED",
          details: {
            manifestId: locked.id,
            sha256: locked.sha256,
            deletedAt: now.toISOString(),
          },
          manager,
        });
      });
    } catch (error) {
      const attempts = manifest.deletionAttempts + 1;
      const deadLetter = attempts >= MAX_ATTEMPTS;
      await this.manifests.update(manifest.id, {
        deletionAttempts: attempts,
        deletionLastError: sanitizeError(error),
        deletionNextAttemptAt: deadLetter
          ? null
          : new Date(now.getTime() + retryDelayMs(attempts)),
        deletionDeadLetterAt: deadLetter ? now : null,
      });
      this.logger.error(
        `Evidence retention deletion failed manifest=${manifest.id} attempt=${attempts}`,
      );
    }
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempt - 1, 10));
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown deletion error";
  return message.replace(/[\r\n\t]/g, " ").slice(0, 1000);
}
