import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { TonNetwork } from "../../user/entities/ton-wallet-binding.entity";

export enum TonNativeChainEventOutcome {
  ACCEPTED = "accepted",
  REJECTED = "rejected",
}

/** Immutable evidence for every finalized transaction seen on a prepared escrow. */
@Entity("ton_native_chain_events")
@Unique("UQ_ton_native_chain_event_identity", [
  "network",
  "accountAddress",
  "transactionLt",
  "transactionHash",
])
@Index(["outcome", "appliedAt"])
@Index(["dealId", "createdAt"])
export class TonNativeChainEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  preparationId: string;

  @Column({ type: "uuid" })
  dealId: string;

  @Column({ type: "varchar", length: 40, default: "fund" })
  eventType: string;

  @Column({ type: "uuid", nullable: true })
  intentId: string | null;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  @Column({ type: "varchar", length: 128 })
  accountAddress: string;

  @Column({ type: "varchar", length: 20 })
  transactionLt: string;

  @Column({ type: "varchar", length: 128 })
  transactionHash: string;

  @Column({ type: "integer" })
  masterchainSeqno: number;

  @Column({ type: "integer" })
  transactionTime: number;

  @Column({ type: "varchar", length: 128, nullable: true })
  messageHash: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  sourceAddress: string | null;

  @Column({ type: "varchar", length: 78, nullable: true })
  valueAtomic: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  payloadHash: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  postCodeHash: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  postConfigHash: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  postStateHash: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  postDataHash: string | null;

  @Column({ type: "timestamp", nullable: true })
  reconciledAt: Date | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  reconciliationSource: string | null;

  @Column({ type: "jsonb", nullable: true })
  reconciliationEvidence: Record<string, unknown> | null;

  @Column({ type: "text", nullable: true })
  reconciliationError: string | null;

  @Column({ type: "varchar", length: 16 })
  outcome: TonNativeChainEventOutcome;

  @Column({ type: "varchar", length: 64 })
  reasonCode: string;

  @Column({ type: "jsonb", default: {} })
  evidence: Record<string, unknown>;

  @Column({ type: "integer", default: 0 })
  applyAttempts: number;

  @Column({ type: "timestamp", nullable: true })
  appliedAt: Date | null;

  @Column({ type: "timestamp", nullable: true })
  automationStoppedAt: Date | null;

  @Column({ type: "text", nullable: true })
  lastApplyError: string | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
