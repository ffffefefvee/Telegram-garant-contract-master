import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Idempotency ledger for inbound payment-provider webhooks.
 *
 * Payment providers (Cryptomus) re-deliver the same webhook multiple times —
 * on their own retry schedule, after our transient failures, or on manual
 * replay from their dashboard. Without a dedup guard a re-delivered `paid`
 * event would re-run `forwardAndFund`, sending a SECOND USDT transfer from the
 * relay hot-wallet into the escrow clone (real money lost).
 *
 * A row is atomically claimed BEFORE any external side effect. The unique
 * `(provider, eventKey)` pair is therefore a cross-replica mutex enforced by
 * PostgreSQL rather than process memory. Failed attempts release their claim;
 * successful attempts retain it permanently.
 */
@Entity({ name: 'processed_webhook_events' })
@Unique('UQ_processed_webhook_provider_key', ['provider', 'eventKey'])
@Index(['createdAt'])
export class ProcessedWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Source of the event, e.g. `cryptomus`. */
  @Column({ type: 'varchar', length: 32 })
  provider: string;

  /**
   * Provider-unique key for the event instance. For Cryptomus this combines
   * the order id, status and on-chain txid so each distinct state transition
   * is recorded once while genuine retries of the same transition dedupe.
   */
  @Column({ type: 'varchar', length: 255 })
  eventKey: string;

  @Column({ type: 'varchar', length: 16, default: 'processing' })
  processingState: 'processing' | 'completed';

  /** Order id (our payment `transactionId`) for debugging/correlation. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  orderId: string | null;

  /** Provider status string at the time it was recorded. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  status: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
