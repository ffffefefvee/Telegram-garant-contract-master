import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum TonNativeRecoveryRequestStatus {
  PENDING = "pending",
  EXECUTED = "executed",
  CANCELLED = "cancelled",
  EXPIRED = "expired",
}

@Entity("ton_native_recovery_requests")
@Index(["eventId", "status"])
export class TonNativeRecoveryRequest {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  eventId: string;

  @Column({ type: "uuid" })
  requestedBy: string;

  @Column({ type: "varchar", length: 128 })
  requesterJti: string;

  @Column({ type: "varchar", length: 128 })
  requesterSid: string;

  @Column({ type: "uuid", nullable: true })
  approvedBy: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  approverJti: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  approverSid: string | null;

  @Column({ type: "varchar", length: 24 })
  status: TonNativeRecoveryRequestStatus;

  @Column({ type: "text" })
  reason: string;

  @Column({ type: "text" })
  expectedLastError: string;

  @Column({ type: "char", length: 64, unique: true })
  intentHash: string;

  @Column({ type: "timestamp" })
  expiresAt: Date;

  @Column({ type: "timestamp", nullable: true })
  approvedAt: Date | null;

  @Column({ type: "timestamp", nullable: true })
  executedAt: Date | null;

  @Column({ type: "timestamp", nullable: true })
  cancelledAt: Date | null;

  @Column({ type: "uuid", nullable: true })
  cancelledBy: string | null;

  @Column({ type: "text", nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
