import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

/** Durable lifecycle for one externally observable money operation. */
export enum PaymentOperationStatus {
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED_RETRYABLE = "failed_retryable",
  MANUAL_REVIEW = "manual_review",
}

/**
 * Cross-replica record of a payment side effect.
 *
 * Unlike a bare webhook-dedup row, this retains the lease, attempt count,
 * outcome and transaction hashes required to resume safely after a process
 * crash. The operation key is a stable provider event + business action,
 * never a request ID, so provider retries map to exactly the same record.
 */
@Entity({ name: "payment_operations" })
@Unique("UQ_payment_operation_provider_key_type", [
  "provider",
  "eventKey",
  "operationType",
])
@Index(["status", "leaseExpiresAt"])
@Index(["dealId"])
export class PaymentOperation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 32 })
  provider: string;

  @Column({ type: "varchar", length: 255 })
  eventKey: string;

  @Column({ type: "varchar", length: 48 })
  operationType: string;

  @Column({ type: "uuid", nullable: true })
  paymentId: string | null;

  @Column({ type: "uuid", nullable: true })
  dealId: string | null;

  @Column({
    type: "varchar",
    length: 24,
    default: PaymentOperationStatus.PROCESSING,
  })
  status: PaymentOperationStatus;

  @Column({ type: "integer", default: 0 })
  attempts: number;

  /** Random, process-local token. Never treated as a user identity. */
  @Column({ type: "varchar", length: 64, nullable: true })
  leaseOwner: string | null;

  @Column({ type: "timestamp", nullable: true })
  leaseExpiresAt: Date | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  transferTxHash: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  notifyTxHash: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  lastErrorCode: string | null;

  @Column({ type: "text", nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
