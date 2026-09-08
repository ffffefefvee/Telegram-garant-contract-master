import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { TonNetwork } from "../../user/entities/ton-wallet-binding.entity";
import { TonJettonEscrowPreparation } from "./ton-jetton-escrow-preparation.entity";

export enum TonJettonEscrowWatchStatus {
  AWAITING_FUNDING = "awaiting_funding",
  FUNDED = "funded",
  DELIVERED = "delivered",
  DISPUTED = "disputed",
  SETTLEMENT_PENDING = "settlement_pending",
  RECOVERY_REQUIRED = "recovery_required",
  SETTLED_FINALIZED = "settled_finalized",
  MANUAL_REVIEW = "manual_review",
  SUPERSEDED = "superseded",
}

/** Mutable projection for exactly one immutable preparation version. */
@Entity("ton_jetton_escrow_watches")
@Index(["network", "accountAddress"], { unique: true })
@Index(["status", "updatedAt"])
export class TonJettonEscrowWatch {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", unique: true })
  preparationId: string;

  @OneToOne(() => TonJettonEscrowPreparation, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "preparationId" })
  preparation: TonJettonEscrowPreparation;

  @Column({ type: "uuid" })
  dealId: string;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  @Column({ type: "varchar", length: 128 })
  accountAddress: string;

  @Column({ type: "varchar", length: 32 })
  status: TonJettonEscrowWatchStatus;

  @Column({ type: "integer", default: 0 })
  consecutiveFailures: number;

  @Column({ type: "text", nullable: true })
  lastError: string | null;

  @Column({ type: "timestamp", nullable: true })
  lastAppliedAt: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
