import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum SettlementCircuitScope {
  TON = "ton",
  POLYGON = "polygon",
  GLOBAL = "global",
}

export enum SettlementCircuitState {
  CLOSED = "closed",
  TRIPPED = "tripped",
}

export enum SettlementIncidentKind {
  RECONCILIATION_DISCREPANCY = "reconciliation_discrepancy",
  SOURCE_DISAGREEMENT = "source_disagreement",
  SHARED_LEDGER = "shared_ledger",
  AUTHENTICATION = "authentication",
  GOVERNANCE = "governance",
}

/** Mutable current state. Every transition is also written to immutable audit. */
@Entity("settlement_circuit_breakers")
export class SettlementCircuitBreaker {
  @PrimaryColumn({ type: "varchar", length: 16 })
  scope: SettlementCircuitScope;

  @Column({ type: "varchar", length: 16 })
  state: SettlementCircuitState;

  @Column({ type: "varchar", length: 40, nullable: true })
  incidentKind: SettlementIncidentKind | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  reasonCode: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  assetCode: string | null;

  @Column({ type: "varchar", length: 78, nullable: true })
  discrepancyAtomic: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  evidenceHash: string | null;

  @Column({ type: "timestamp", nullable: true })
  trippedAt: Date | null;

  @Column({ type: "integer", default: 0 })
  revision: number;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}

/** Append-only evidence for every circuit transition attempt. */
@Entity("settlement_circuit_breaker_audit")
@Index(["scope", "createdAt"])
export class SettlementCircuitBreakerAudit {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 16 })
  scope: SettlementCircuitScope;

  @Column({ type: "varchar", length: 16 })
  previousState: SettlementCircuitState;

  @Column({ type: "varchar", length: 16 })
  nextState: SettlementCircuitState;

  @Column({ type: "varchar", length: 40 })
  incidentKind: SettlementIncidentKind;

  @Column({ type: "varchar", length: 64 })
  reasonCode: string;

  @Column({ type: "varchar", length: 32, nullable: true })
  assetCode: string | null;

  @Column({ type: "varchar", length: 78, nullable: true })
  discrepancyAtomic: string | null;

  @Column({ type: "varchar", length: 64 })
  evidenceHash: string;

  @Column({ type: "varchar", length: 128 })
  actorId: string;

  @Column({ type: "integer" })
  revision: number;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
