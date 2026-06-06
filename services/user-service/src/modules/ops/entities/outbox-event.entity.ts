import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum OutboxStatus {
  PENDING = 'pending',
  IN_FLIGHT = 'in_flight',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  DEAD = 'dead',
}

/**
 * Transactional outbox row. Producers `INSERT` in the same DB transaction
 * that mutates business state; the OutboxWorker polls and delivers.
 *
 * Schema is deliberately small + indexed on `(status, availableAt)` so the
 * delivery query stays cheap even when `outbox_events` grows large. The
 * `aggregateType`/`aggregateId` pair lets us correlate events back to the
 * domain object for debugging.
 */
@Entity({ name: 'outbox_events' })
@Index(['status', 'availableAt'])
@Index(['aggregateType', 'aggregateId'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  aggregateType: string;

  @Column({ type: 'varchar', length: 64 })
  aggregateId: string;

  @Column({ type: 'varchar', length: 96 })
  eventType: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp', default: () => 'now()' })
  availableAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
