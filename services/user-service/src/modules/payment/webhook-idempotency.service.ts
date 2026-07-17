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

/** PostgreSQL-backed cross-replica claim for money-moving webhooks. */
@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(
    @InjectRepository(ProcessedWebhookEvent)
    private readonly repo: Repository<ProcessedWebhookEvent>,
  ) {}

  async isProcessed(provider: string, eventKey: string): Promise<boolean> {
    return (await this.repo.findOne({ where: { provider, eventKey }, select: ['id'] })) != null;
  }

  /** Claim before the external transfer. Exactly one replica can return true. */
  async tryClaim(ref: WebhookEventRef): Promise<boolean> {
    try {
      await this.repo.insert({
        provider: ref.provider,
        eventKey: ref.eventKey,
        processingState: 'processing',
        orderId: ref.orderId ?? null,
        status: ref.status ?? null,
      });
      return true;
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        this.logger.debug(`Webhook claim already held: ${ref.provider}/${ref.eventKey}`);
        return false;
      }
      throw err;
    }
  }

  async markProcessed(ref: WebhookEventRef): Promise<void> {
    await this.repo.update(
      { provider: ref.provider, eventKey: ref.eventKey },
      { processingState: 'completed', status: ref.status ?? null },
    );
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
