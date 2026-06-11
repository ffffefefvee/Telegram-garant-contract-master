import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Lifecycle of an unmatched incoming TON deposit:
 *  - unmatched: money arrived at the platform TON wallet but no open
 *    payment claims it (missing memo, typo, or a payment that expired).
 *  - matched: an admin manually credited it to a payment — the standard
 *    funding path then settled the deal.
 *  - ignored: resolved outside the system (e.g. refunded manually).
 */
export type UnmatchedDepositStatus = 'unmatched' | 'matched' | 'ignored';

/**
 * Ledger of incoming USDT-TON transfers to the platform wallet that the
 * watcher could NOT attribute to any payment. For an escrow service this
 * is real customer money in limbo — it must never be silently dropped.
 *
 * Rows are written by `TonUnmatchedScanner` (idempotent by
 * eventId+actionIndex) and resolved by admins via `TonRecoveryService`.
 */
@Entity('ton_unmatched_deposits')
@Unique(['eventId', 'actionIndex'])
@Index(['status'])
@Index(['createdAt'])
export class TonUnmatchedDeposit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** tonapi event id (proof-of-payment reference). */
  @Column({ type: 'varchar', length: 100 })
  eventId: string;

  /** Index of the JettonTransfer action inside the event. */
  @Column({ type: 'int', default: 0 })
  actionIndex: number;

  /** On-chain timestamp of the transfer (unix seconds). */
  @Column({ type: 'bigint' })
  txTimestamp: number;

  /** Sender address as reported by tonapi (raw `0:hex` form). */
  @Column({ type: 'varchar', length: 100 })
  senderAddress: string;

  /** Amount in raw jetton units (6 dp), stored as string — bigint-safe. */
  @Column({ type: 'varchar', length: 40 })
  amountUnits: string;

  /** Transfer comment as sent (may be empty or a memo typo). */
  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'varchar', length: 16, default: 'unmatched' })
  status: UnmatchedDepositStatus;

  /**
   * Set when the comment matches the memo of a payment that can no longer
   * accept funds (expired/failed) — a strong hint for the admin about who
   * this money belongs to.
   */
  @Column({ type: 'uuid', nullable: true })
  paymentHintId: string | null;

  /** Payment this deposit was manually credited to (status=matched). */
  @Column({ type: 'uuid', nullable: true })
  matchedPaymentId: string | null;

  /** Admin who resolved the row (matched or ignored). */
  @Column({ type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
