import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { OutboxEvent, OutboxStatus } from './entities/outbox-event.entity';

export interface OutboxStats {
  pending: number;
  inFlight: number;
  delivered: number;
  dead: number;
}

export interface EnqueueInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  /** Delay until the worker may pick it up. Defaults to "now". */
  availableAt?: Date;
  /**
   * If you're already inside a transaction, pass the EntityManager so the
   * outbox row commits atomically with your business write.
   */
  manager?: EntityManager;
}

/**
 * Producer-side API for the transactional outbox.
 *
 * Typical usage from a domain service:
 *
 *     await this.dataSource.transaction(async (m) => {
 *       await m.save(deal);
 *       await this.outbox.enqueue({
 *         aggregateType: 'deal',
 *         aggregateId: deal.id,
 *         eventType: 'deal.created',
 *         payload: { ... },
 *         manager: m,
 *       });
 *     });
 *
 * The OutboxWorker (a separate cron service) picks up `pending` rows and
 * delivers them. Delivery is best-effort and retried on failure.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {}

  async enqueue(input: EnqueueInput): Promise<OutboxEvent> {
    const repo = input.manager
      ? input.manager.getRepository(OutboxEvent)
      : this.repo;
    const event = repo.create({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload ?? {},
      availableAt: input.availableAt ?? new Date(),
      status: OutboxStatus.PENDING,
      attempts: 0,
    });
    const saved = await repo.save(event);
    this.logger.debug(
      `Outbox enqueued ${saved.eventType} ${saved.aggregateType}/${saved.aggregateId} (id=${saved.id})`,
    );
    return saved;
  }

  /**
   * Atomically claim up to `limit` events that are due for delivery.
   * Uses `FOR UPDATE SKIP LOCKED` so multiple workers can run in parallel
   * without contention or double-processing.
   */
  async claimBatch(limit = 25): Promise<OutboxEvent[]> {
    return this.repo.manager.transaction(async (m) => {
      const due = await m
        .createQueryBuilder(OutboxEvent, 'e')
        .where('e.status = :status', { status: OutboxStatus.PENDING })
        .andWhere('e.availableAt <= now()')
        .orderBy('e.availableAt', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      if (due.length === 0) return [];
      for (const e of due) {
        e.status = OutboxStatus.IN_FLIGHT;
      }
      await m.save(due);
      return due;
    });
  }

  async markDelivered(id: string): Promise<void> {
    await this.repo.update(id, {
      status: OutboxStatus.DELIVERED,
      deliveredAt: new Date(),
      lastError: null,
    });
  }

  /**
   * Bump attempt count + reschedule with exponential backoff (capped).
   * After 6 failed attempts the row is parked as DEAD for human review.
   */
  async markFailed(id: string, err: Error): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return;
    row.attempts += 1;
    row.lastError = err.message.slice(0, 1000);
    if (row.attempts >= 6) {
      row.status = OutboxStatus.DEAD;
    } else {
      row.status = OutboxStatus.PENDING;
      const backoffMs = Math.min(60_000, 1000 * 2 ** row.attempts);
      row.availableAt = new Date(Date.now() + backoffMs);
    }
    await this.repo.save(row);
  }

  async listPending(limit = 50): Promise<OutboxEvent[]> {
    return this.repo.find({
      where: {
        status: OutboxStatus.PENDING,
        availableAt: LessThanOrEqual(new Date()),
      },
      order: { availableAt: 'ASC' },
      take: limit,
    });
  }

  async listDeadEvents(limit = 50): Promise<OutboxEvent[]> {
    return this.repo.find({
      where: { status: OutboxStatus.DEAD },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getStats(): Promise<OutboxStats> {
    const [pending, inFlight, delivered, dead] = await Promise.all([
      this.repo.count({ where: { status: OutboxStatus.PENDING } }),
      this.repo.count({ where: { status: OutboxStatus.IN_FLIGHT } }),
      this.repo.count({ where: { status: OutboxStatus.DELIVERED } }),
      this.repo.count({ where: { status: OutboxStatus.DEAD } }),
    ]);
    return { pending, inFlight, delivered, dead };
  }
}
