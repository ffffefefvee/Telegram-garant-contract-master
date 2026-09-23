import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export enum TonUnmatchedRecoveryAction {
  MATCH = "match",
  IGNORE = "ignore",
}

export enum TonUnmatchedRecoveryStatus {
  PENDING = "pending",
  EXECUTED = "executed",
  CANCELLED = "cancelled",
  EXPIRED = "expired",
}

@Entity("ton_unmatched_recovery_requests")
@Index(["depositId", "status"])
export class TonUnmatchedRecoveryRequest {
  @PrimaryGeneratedColumn("uuid") id: string;
  @Column({ type: "uuid", name: "deposit_id" }) depositId: string;
  @Column({ type: "varchar", length: 16 }) action: TonUnmatchedRecoveryAction;
  @Column({ type: "uuid", name: "payment_id", nullable: true }) paymentId: string | null;
  @Column({ type: "text", nullable: true }) reason: string | null;
  @Column({ type: "char", length: 64, name: "intent_hash", unique: true }) intentHash: string;
  @Column({ type: "timestamp", name: "expected_deposit_updated_at" }) expectedDepositUpdatedAt: Date;
  @Column({ type: "char", length: 64, name: "expected_payment_state_hash", nullable: true }) expectedPaymentStateHash: string | null;
  @Column({ type: "uuid", name: "requested_by" }) requestedBy: string;
  @Column({ type: "varchar", length: 128, name: "requester_jti" }) requesterJti: string;
  @Column({ type: "varchar", length: 128, name: "requester_sid" }) requesterSid: string;
  @Column({ type: "uuid", name: "approved_by", nullable: true }) approvedBy: string | null;
  @Column({ type: "varchar", length: 128, name: "approver_jti", nullable: true }) approverJti: string | null;
  @Column({ type: "varchar", length: 128, name: "approver_sid", nullable: true }) approverSid: string | null;
  @Column({ type: "varchar", length: 16, default: TonUnmatchedRecoveryStatus.PENDING }) status: TonUnmatchedRecoveryStatus;
  @Column({ type: "timestamp", name: "expires_at" }) expiresAt: Date;
  @Column({ type: "timestamp", name: "executed_at", nullable: true }) executedAt: Date | null;
  @Column({ type: "timestamp", name: "cancelled_at", nullable: true }) cancelledAt: Date | null;
  @Column({ type: "uuid", name: "cancelled_by", nullable: true }) cancelledBy: string | null;
  @Column({ type: "text", name: "cancellation_reason", nullable: true }) cancellationReason: string | null;
  @CreateDateColumn({ type: "timestamp", name: "created_at" }) createdAt: Date;
}
