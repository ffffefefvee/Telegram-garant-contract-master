import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Per-user notification opt-outs. One row per user; if no row exists, the
 * dispatcher treats all channels as enabled (default-on semantics).
 *
 * `mutedEventTypes` is a jsonb list of outbox `eventType` strings (e.g.
 * `'dispute.opened'`, `'deal.payment_received'`). If `mutedAll` is true
 * we skip delivery regardless of eventType.
 *
 * `quietHoursStart` / `quietHoursEnd` are HH:MM strings in the user's
 * local Telegram timezone. If both set and current time falls in the
 * window, events are deferred (not dropped) — the worker reschedules
 * the outbox row to fire after the window closes.
 */
@Entity({ name: 'notification_preferences' })
@Unique(['userId'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'boolean', default: false })
  mutedAll: boolean;

  @Column({ type: 'jsonb', default: [] })
  mutedEventTypes: string[];

  @Column({ type: 'varchar', length: 5, nullable: true })
  quietHoursStart: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  quietHoursEnd: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
