import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { TonNetwork } from "../../user/entities/ton-wallet-binding.entity";

export enum TonJettonChainEventOutcome {
  ACCEPTED = "accepted",
  REJECTED = "rejected",
}

export enum TonJettonChainEventKind {
  FUNDING_CONFIRMED = "funding_confirmed",
  MARK_DELIVERED = "mark_delivered",
  OPEN_DISPUTE = "open_dispute",
  SETTLEMENT_STARTED = "settlement_started",
  PAYOUT_LEG_RECONCILED = "payout_leg_reconciled",
  SETTLEMENT_FINALIZED = "settlement_finalized",
  RECOVERY_REQUIRED = "recovery_required",
}

/**
 * Append-only evidence for a finalized transaction observed on a Jetton escrow
 * account. Application progress deliberately lives in a separate table so
 * retries cannot rewrite the evidence that was originally accepted/rejected.
 */
@Entity("ton_jetton_chain_events")
@Unique("UQ_ton_jetton_chain_event_identity", [
  "network",
  "accountAddress",
  "transactionLt",
  "transactionHash",
])
@Index(["outcome", "createdAt"])
export class TonJettonChainEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  preparationId: string;

  @Column({ type: "uuid", nullable: true })
  actionIntentId: string | null;

  @Column({ type: "varchar", length: 40 })
  eventKind: TonJettonChainEventKind;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  @Column({ type: "varchar", length: 128 })
  accountAddress: string;

  @Column({ type: "varchar", length: 20 })
  transactionLt: string;

  @Column({ type: "varchar", length: 64 })
  transactionHash: string;

  @Column({ type: "integer" })
  masterchainSeqno: number;

  @Column({ type: "integer" })
  transactionTime: number;

  @Column({ type: "varchar", length: 64, nullable: true })
  messageHash: string | null;

  @Column({ type: "varchar", length: 16 })
  outcome: TonJettonChainEventOutcome;

  @Column({ type: "varchar", length: 64 })
  reasonCode: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  correlationKey: string | null;

  @Column({ type: "jsonb" })
  evidence: Record<string, unknown>;

  @Column({ type: "varchar", length: 64 })
  evidenceHash: string;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}

export enum TonJettonEventApplicationStatus {
  PENDING = "pending",
  APPLIED = "applied",
  MANUAL_REVIEW = "manual_review",
}

/** Mutable delivery state; the referenced TonJettonChainEvent stays immutable. */
@Entity("ton_jetton_event_applications")
@Index(["status", "updatedAt"])
export class TonJettonEventApplication {
  @PrimaryColumn({ type: "uuid" })
  eventId: string;

  @OneToOne(() => TonJettonChainEvent, { onDelete: "CASCADE" })
  @JoinColumn({ name: "eventId" })
  event: TonJettonChainEvent;

  @Column({
    type: "varchar",
    length: 24,
    default: TonJettonEventApplicationStatus.PENDING,
  })
  status: TonJettonEventApplicationStatus;

  @Column({ type: "integer", default: 0 })
  attempts: number;

  @Column({ type: "text", nullable: true })
  lastError: string | null;

  @Column({ type: "timestamp", nullable: true })
  appliedAt: Date | null;

  @Column({ type: "timestamp", nullable: true })
  manualReviewAt: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}

/** Durable high-water mark for one network/account scan. */
@Entity("ton_jetton_ingestion_cursors")
@Unique("UQ_ton_jetton_cursor_account", ["network", "accountAddress"])
export class TonJettonIngestionCursor {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  @Column({ type: "varchar", length: 128 })
  accountAddress: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  lastFinalizedLt: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  lastFinalizedTxHash: string | null;

  @Column({ type: "integer", nullable: true })
  lastFinalizedMcSeqno: number | null;

  @Column({ type: "timestamp", nullable: true })
  lastScannedAt: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}

export enum TonJettonCursorCheckpointKind {
  ADVANCE = "advance",
  RECOVERY = "recovery",
}

/** Append-only history proving every high-water advance or manual rewind. */
@Entity("ton_jetton_ingestion_cursor_checkpoints")
@Index(["cursorId", "createdAt"])
export class TonJettonIngestionCursorCheckpoint {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  cursorId: string;

  @Column({ type: "varchar", length: 16 })
  kind: TonJettonCursorCheckpointKind;

  @Column({ type: "varchar", length: 20, nullable: true })
  previousLt: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  previousHash: string | null;

  @Column({ type: "integer", nullable: true })
  previousMcSeqno: number | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  nextLt: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  nextHash: string | null;

  @Column({ type: "integer", nullable: true })
  nextMcSeqno: number | null;

  @Column({ type: "varchar", length: 64 })
  reasonCode: string;

  @Column({ type: "varchar", length: 128 })
  actorId: string;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}

export enum TonJettonApplicationReviewAction {
  REQUEUE = "requeue",
}

/** Append-only operator evidence for a stopped application's recovery. */
@Entity("ton_jetton_application_reviews")
@Index(["eventId", "createdAt"])
export class TonJettonApplicationReview {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  eventId: string;

  @Column({ type: "varchar", length: 16 })
  action: TonJettonApplicationReviewAction;

  @Column({ type: "integer" })
  previousAttempts: number;

  @Column({ type: "text", nullable: true })
  previousError: string | null;

  @Column({ type: "varchar", length: 64 })
  reasonCode: string;

  @Column({ type: "varchar", length: 128 })
  actorId: string;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
