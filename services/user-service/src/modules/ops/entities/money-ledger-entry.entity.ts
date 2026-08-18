import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

/** Immutable double-entry record for confirmed financial movement. */
@Entity({ name: "money_ledger_entries" })
@Unique("UQ_money_ledger_idempotency_key", ["idempotencyKey"])
@Index(["dealId", "createdAt"])
export class MoneyLedgerEntry {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", nullable: true })
  dealId: string | null;

  @Column({ type: "uuid", nullable: true })
  paymentId: string | null;

  @Column({ type: "varchar", length: 96 })
  idempotencyKey: string;

  @Column({ type: "varchar", length: 64 })
  debitAccount: string;

  @Column({ type: "varchar", length: 64 })
  creditAccount: string;

  @Column({ type: "decimal", precision: 36, scale: 18 })
  amount: string;

  @Column({ type: "varchar", length: 12 })
  currency: string;

  @Column({ type: "varchar", length: 48 })
  entryType: string;

  @Column({ type: "jsonb", default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
