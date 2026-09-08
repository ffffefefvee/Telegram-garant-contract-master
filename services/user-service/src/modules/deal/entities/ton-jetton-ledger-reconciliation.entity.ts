import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/** Append-only comparison of finalized on-chain assets to ledger liabilities. */
@Entity("ton_jetton_ledger_reconciliations")
@Index(["preparationId", "createdAt"])
export class TonJettonLedgerReconciliation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  preparationId: string;

  @Column({ type: "varchar", length: 78 })
  onChainAssetsAtomic: string;

  @Column({ type: "varchar", length: 78 })
  ledgerLiabilitiesAtomic: string;

  @Column({ type: "varchar", length: 79 })
  deltaAtomic: string;

  @Column({ type: "varchar", length: 64 })
  evidenceHash: string;

  @Column({ type: "boolean" })
  breakerTripped: boolean;

  @Column({ type: "varchar", length: 128 })
  actorId: string;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
