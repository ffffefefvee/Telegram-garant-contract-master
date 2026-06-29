import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity';

/** Postgres unique-violation SQLSTATE; SQLite surfaces it in the message. */
const PG_UNIQUE_VIOLATION = '23505';

export interface WebhookEventRef {
  provider: string;
  eventKey: string;
  orderId?: string | null;
  status?: string | null;
}

/**
 * Persistent idempotency guard for inbound payment webhooks.
 *
 * Usage is "check, do work, then mark":
 *   1. `isProcessed` — skip the whole delivery if we already applied it.
 *   2. apply side effects (forward funds, transition deal, …).
 *   3. `markProcessed` — record the event so future re-deliveries skip.
 *
 * Marking only AFTER the work commits means a crash mid-delivery leaves no
 * row, so the provider's retry (or reconciliation) can finish the job. The
 * unique `(provider, eventKey)` constraint makes `markProcessed` safe under
 * concurrent duplicate deliveries — the loser swallows the violation.
 */
@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(
    @InjectRepository(ProcessedWebhookEvent)
    private readonly repo: Repository<ProcessedWebhookEvent>,
  ) {}

  /** True if this exact event was already fully processed before. */
  async isProcessed(provider: string, eventKey: string): Promise<boolean> {
    const existing = await this.repo.findOne({
      where: { provider, eventKey },
      select: ['id'],
    });
    return existing != null;
  }

  /**
   * Record an event as processed. Idempotent: a duplicate insert (concurrent
   * delivery or replay) is swallowed instead of throwing, so callers never
   * need to special-case the race.
   */
  async markProcessed(ref: WebhookEventRef): Promise<void> {
    try {
      await this.repo.insert({
        provider: ref.provider,
        eventKey: ref.eventKey,
        orderId: ref.orderId ?? null,
        status: ref.status ?? null,
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        this.logger.debug(
          `Webhook event already recorded (race): ${ref.provider}/${ref.eventKey}`,
        );
        return;
      }
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    if (err instanceof QueryFailedError) {
      const code = (err as QueryFailedError & { code?: string }).code;
      if (code === PG_UNIQUE_VIOLATION) {
        return true;
      }
      // SQLite (tests) reports the violation only in the message.
      return /unique/i.test(err.message);
    }
    return false;
  }
}
