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

  @Column({ type: "uuid", nullable: true })
  approvedBy: string | null;

  @Column({ type: "varchar", length: 24 })
  status: TonNativeRecoveryRequestStatus;

  @Column({ type: "text" })
  reason: string;

  @Column({ type: "text" })
  expectedLastError: string;

  @Column({ type: "timestamp", nullable: true })
  approvedAt: Date | null;

  @Column({ type: "timestamp", nullable: true })
  executedAt: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
