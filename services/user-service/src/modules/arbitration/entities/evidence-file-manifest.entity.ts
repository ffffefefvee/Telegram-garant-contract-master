import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("evidence_file_manifests")
@Index(["evidenceId"], { unique: true })
@Index(["sha256"])
@Index(["retentionUntil"])
export class EvidenceFileManifest {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "evidence_id", unique: true })
  evidenceId: string;

  @Column({ type: "varchar", length: 512, name: "storage_key", unique: true })
  storageKey: string;

  @Column({ type: "varchar", length: 100, name: "media_type" })
  mediaType: string;

  @Column({ type: "bigint" })
  size: string;

  @Column({ type: "char", length: 64 })
  sha256: string;

  @Column({ type: "varchar", length: 100, name: "scanner_name" })
  scannerName: string;

  @Column({ type: "varchar", length: 128, name: "scanner_version" })
  scannerVersion: string;

  @Column({ type: "varchar", length: 128, name: "scanner_policy_version" })
  scannerPolicyVersion: string;

  @Column({ type: "varchar", length: 128, name: "scanner_result_id" })
  scannerResultId: string;

  @Column({ type: "char", length: 64, name: "scan_evidence_hash" })
  scanEvidenceHash: string;

  @Column({ type: "char", length: 64, name: "manifest_hash", unique: true })
  manifestHash: string;

  @Column({ type: "timestamp", name: "scanned_at" })
  scannedAt: Date;

  @Column({ type: "timestamp", name: "retention_until" })
  retentionUntil: Date;

  @Column({ type: "timestamp", name: "deleted_at", nullable: true })
  deletedAt: Date | null;

  @Column({ type: "text", name: "deletion_reason", nullable: true })
  deletionReason: string | null;

  @Column({ type: "integer", name: "deletion_attempts", default: 0 })
  deletionAttempts: number;

  @Column({ type: "timestamp", name: "deletion_next_attempt_at", nullable: true })
  deletionNextAttemptAt: Date | null;

  @Column({ type: "text", name: "deletion_last_error", nullable: true })
  deletionLastError: string | null;

  @Column({ type: "timestamp", name: "deletion_dead_letter_at", nullable: true })
  deletionDeadLetterAt: Date | null;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;
}
