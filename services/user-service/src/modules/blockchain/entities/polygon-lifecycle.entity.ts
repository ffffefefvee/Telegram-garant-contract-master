import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum PolygonEventStatus {
  FINALIZED = "finalized",
  ORPHANED = "orphaned",
  APPLIED = "applied",
  REJECTED = "rejected",
}

export enum PolygonRelayTxStatus {
  RESERVED = "reserved",
  BROADCAST = "broadcast",
  REPLACING = "replacing",
  REPLACED = "replaced",
  CONFIRMED = "confirmed",
  FAILED = "failed",
}

/** One durable forward-only cursor per EVM chain. */
@Entity("polygon_lifecycle_cursors")
export class PolygonLifecycleCursor {
  @PrimaryColumn({ type: "integer", name: "chain_id" })
  chainId: number;

  @Column({ type: "bigint", name: "next_block" })
  nextBlock: string;

  @Column({ type: "bigint", nullable: true, name: "last_finalized_block" })
  lastFinalizedBlock: string | null;

  @Column({ type: "varchar", length: 66, nullable: true, name: "last_finalized_hash" })
  lastFinalizedHash: string | null;

  @Column({ type: "integer", default: 0 })
  revision: number;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt: Date;
}

/** Raw finalized log. It is immutable except for its explicit application status. */
@Entity("polygon_chain_events")
@Index(["chainId", "transactionHash", "logIndex"], { unique: true })
@Index(["chainId", "blockNumber", "status"])
@Index(["escrowAddress", "blockNumber"])
export class PolygonChainEvent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "integer", name: "chain_id" })
  chainId: number;

  @Column({ type: "varchar", length: 42, name: "contract_address" })
  contractAddress: string;

  @Column({ type: "varchar", length: 42, nullable: true, name: "escrow_address" })
  escrowAddress: string | null;

  @Column({ type: "varchar", length: 64, name: "event_name" })
  eventName: string;

  @Column({ type: "varchar", length: 66, name: "transaction_hash" })
  transactionHash: string;

  @Column({ type: "integer", name: "log_index" })
  logIndex: number;

  @Column({ type: "bigint", name: "block_number" })
  blockNumber: string;

  @Column({ type: "varchar", length: 66, name: "block_hash" })
  blockHash: string;

  @Column({ type: "jsonb" })
  topics: string[];

  @Column({ type: "text" })
  data: string;

  @Column({ type: "jsonb", nullable: true, name: "decoded_payload" })
  decodedPayload: Record<string, string> | null;

  @Column({ type: "varchar", length: 16 })
  status: PolygonEventStatus;

  @Column({ type: "varchar", length: 64, name: "evidence_hash" })
  evidenceHash: string;

  @Column({ type: "timestamp", name: "finalized_at" })
  finalizedAt: Date;

  @Column({ type: "timestamp", nullable: true, name: "applied_at" })
  appliedAt: Date | null;

  @Column({ type: "timestamp", nullable: true, name: "orphaned_at" })
  orphanedAt: Date | null;

  @Column({ type: "varchar", length: 128, nullable: true, name: "rejection_reason" })
  rejectionReason: string | null;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;
}

/** Cross-process nonce allocator state for the one relay identity on a chain. */
@Entity("polygon_relay_nonce_state")
export class PolygonRelayNonceState {
  @PrimaryColumn({ type: "integer", name: "chain_id" })
  chainId: number;

  @PrimaryColumn({ type: "varchar", length: 42, name: "signer_address" })
  signerAddress: string;

  @Column({ type: "bigint", name: "next_nonce" })
  nextNonce: string;

  @Column({ type: "integer", default: 0 })
  revision: number;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt: Date;
}

/** Durable broadcast/replacement history; operation_key makes retries idempotent. */
@Entity("polygon_relay_transactions")
@Index(["chainId", "signerAddress", "nonce"], { unique: true })
@Index(["chainId", "status", "updatedAt"])
export class PolygonRelayTransaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 64, unique: true, name: "operation_key" })
  operationKey: string;

  @Column({ type: "varchar", length: 64, name: "operation_kind" })
  operationKind: string;

  @Column({ type: "integer", name: "chain_id" })
  chainId: number;

  @Column({ type: "varchar", length: 42, name: "signer_address" })
  signerAddress: string;

  @Column({ type: "bigint" })
  nonce: string;

  @Column({ type: "varchar", length: 16 })
  status: PolygonRelayTxStatus;

  @Column({ type: "varchar", length: 66, nullable: true, name: "current_tx_hash" })
  currentTxHash: string | null;

  @Column({ type: "varchar", length: 42, nullable: true, name: "tx_to" })
  txTo: string | null;

  @Column({ type: "text", nullable: true, name: "tx_data" })
  txData: string | null;

  @Column({ type: "varchar", length: 78, nullable: true, name: "tx_value" })
  txValue: string | null;

  @Column({ type: "varchar", length: 78, nullable: true, name: "gas_limit" })
  gasLimit: string | null;

  @Column({ type: "varchar", length: 78, nullable: true, name: "gas_price" })
  gasPrice: string | null;

  @Column({ type: "varchar", length: 78, nullable: true, name: "max_fee_per_gas" })
  maxFeePerGas: string | null;

  @Column({ type: "varchar", length: 78, nullable: true, name: "max_priority_fee_per_gas" })
  maxPriorityFeePerGas: string | null;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb", name: "replaced_tx_hashes" })
  replacedTxHashes: string[];

  @Column({ type: "integer", default: 0 })
  attempts: number;

  @Column({ type: "timestamp", nullable: true, name: "broadcast_at" })
  broadcastAt: Date | null;

  @Column({ type: "timestamp", nullable: true, name: "confirmed_at" })
  confirmedAt: Date | null;

  @Column({ type: "bigint", nullable: true, name: "confirmed_block" })
  confirmedBlock: string | null;

  @Column({ type: "varchar", length: 128, nullable: true, name: "failure_code" })
  failureCode: string | null;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp", name: "updated_at" })
  updatedAt: Date;
}

/** Immutable independent-RPC balance and identity reconciliation evidence. */
@Entity("polygon_reconciliations")
@Index(["dealId", "createdAt"])
export class PolygonReconciliationRecord {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "deal_id" })
  dealId: string;

  @Column({ type: "integer", name: "chain_id" })
  chainId: number;

  @Column({ type: "varchar", length: 42, name: "escrow_address" })
  escrowAddress: string;

  @Column({ type: "bigint", name: "finalized_block" })
  finalizedBlock: string;

  @Column({ type: "varchar", length: 66, name: "finalized_block_hash" })
  finalizedBlockHash: string;

  @Column({ type: "varchar", length: 78, name: "assets_atomic" })
  assetsAtomic: string;

  @Column({ type: "varchar", length: 78, name: "liabilities_atomic" })
  liabilitiesAtomic: string;

  @Column({ type: "boolean" })
  matches: boolean;

  @Column({ type: "varchar", length: 128, nullable: true, name: "reason_code" })
  reasonCode: string | null;

  @Column({ type: "varchar", length: 64, name: "evidence_hash" })
  evidenceHash: string;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt: Date;
}
