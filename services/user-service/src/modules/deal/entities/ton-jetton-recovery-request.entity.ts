import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum TonJettonRecoveryKind {
  CURSOR = "cursor",
  REQUEUE = "requeue",
}

export enum TonJettonRecoveryStatus {
  PENDING = "pending",
  EXECUTED = "executed",
  CANCELLED = "cancelled",
  EXPIRED = "expired",
}

/** Immutable operator intent; only approval/terminal state may change. */
@Entity("ton_jetton_recovery_requests")
@Index(["kind", "targetKey", "status"])
export class TonJettonRecoveryRequest {
  @PrimaryGeneratedColumn("uuid") id: string;
  @Column({ type: "varchar", length: 16 }) kind: TonJettonRecoveryKind;
  @Column({ type: "varchar", length: 256 }) targetKey: string;
  @Column({ type: "jsonb" }) target: Record<string, unknown>;
  @Column({ type: "char", length: 64 }) expectedStateHash: string;
  @Column({ type: "varchar", length: 64 }) reasonCode: string;
  @Column({ type: "uuid" }) requestedBy: string;
  @Column({ type: "varchar", length: 128 }) requesterJti: string;
  @Column({ type: "varchar", length: 128 }) requesterSid: string;
  @Column({ type: "uuid", nullable: true }) approvedBy: string | null;
  @Column({ type: "varchar", length: 128, nullable: true }) approverJti: string | null;
  @Column({ type: "varchar", length: 128, nullable: true }) approverSid: string | null;
  @Column({ type: "varchar", length: 16 }) status: TonJettonRecoveryStatus;
  @Column({ type: "char", length: 64, unique: true }) intentHash: string;
  @Column({ type: "timestamp" }) expiresAt: Date;
  @Column({ type: "timestamp", nullable: true }) approvedAt: Date | null;
  @Column({ type: "timestamp", nullable: true }) executedAt: Date | null;
  @Column({ type: "timestamp", nullable: true }) cancelledAt: Date | null;
  @Column({ type: "uuid", nullable: true }) cancelledBy: string | null;
  @CreateDateColumn({ type: "timestamp" }) createdAt: Date;
  @UpdateDateColumn({ type: "timestamp" }) updatedAt: Date;
}
