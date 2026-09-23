import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "audit_export_checkpoints" })
export class AuditExportCheckpoint {
  @PrimaryColumn({ type: "varchar", length: 32 })
  id: string;

  @Column({ type: "bigint", name: "last_sequence" })
  lastSequence: string;

  @Column({ type: "char", length: 64, name: "last_manifest_hash" })
  lastManifestHash: string;

  @Column({ type: "bigint", name: "version" })
  version: string;

  @Column({ type: "timestamp", name: "updated_at" })
  updatedAt: Date;
}

@Entity({ name: "audit_export_receipts" })
export class AuditExportReceipt {
  @PrimaryGeneratedColumn({ type: "bigint" })
  id: string;

  @Column({ type: "varchar", length: 256, name: "object_key", unique: true })
  objectKey: string;

  @Column({ type: "varchar", length: 256, name: "receipt_object_key", unique: true })
  receiptObjectKey: string;

  @Column({ type: "bigint", name: "first_sequence" })
  firstSequence: string;

  @Column({ type: "bigint", name: "last_sequence", unique: true })
  lastSequence: string;

  @Column({ type: "integer", name: "record_count" })
  recordCount: number;

  @Column({ type: "char", length: 64, name: "previous_manifest_hash" })
  previousManifestHash: string;

  @Column({ type: "char", length: 64, name: "manifest_hash", unique: true })
  manifestHash: string;

  @Column({ type: "varchar", length: 256, name: "destination_version_id" })
  destinationVersionId: string;

  @Column({ type: "varchar", length: 256, name: "destination_etag" })
  destinationEtag: string;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;
}
