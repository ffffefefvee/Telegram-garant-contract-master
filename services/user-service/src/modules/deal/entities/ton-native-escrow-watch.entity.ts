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
import { TonNativeEscrowPreparation } from "./ton-native-escrow-preparation.entity";

export enum TonNativeEscrowWatchStatus {
  WATCHING = "watching",
  FUNDED = "funded",
  DISPUTED = "disputed",
  TERMINAL = "terminal",
  MANUAL_REVIEW = "manual_review",
}

/** Durable per-contract scan cursor. Account transaction LTs are monotonic. */
@Entity("ton_native_escrow_watches")
@Index(["status", "lastScannedAt"])
@Index(["network", "accountAddress"], { unique: true })
export class TonNativeEscrowWatch {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", unique: true })
  preparationId: string;

  @OneToOne(() => TonNativeEscrowPreparation, { onDelete: "CASCADE" })
  @JoinColumn({ name: "preparationId" })
  preparation: TonNativeEscrowPreparation;

  @Column({ type: "uuid", unique: true })
  dealId: string;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  @Column({ type: "varchar", length: 128 })
  accountAddress: string;

  @Column({
    type: "varchar",
    length: 24,
    default: TonNativeEscrowWatchStatus.WATCHING,
  })
  status: TonNativeEscrowWatchStatus;

  @Column({ type: "varchar", length: 20, nullable: true })
  lastFinalizedLt: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  lastFinalizedTxHash: string | null;

  @Column({ type: "integer", nullable: true })
  lastFinalizedMcSeqno: number | null;

  @Column({ type: "timestamp", nullable: true })
  lastScannedAt: Date | null;

  @Column({ type: "integer", default: 0 })
  consecutiveFailures: number;

  @Column({ type: "text", nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
