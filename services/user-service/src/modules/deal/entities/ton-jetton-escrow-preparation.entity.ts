import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { TonNetwork } from "../../user/entities/ton-wallet-binding.entity";

/**
 * Immutable, versioned inputs that bind one deal to one Jetton escrow.
 *
 * A new version is inserted whenever any canonical input changes. Rows are
 * protected from UPDATE/DELETE by the PostgreSQL migration so a funded
 * preparation can never be rewritten in place.
 */
@Entity("ton_jetton_escrow_preparations")
@Unique("UQ_ton_jetton_preparation_deal_version", ["dealId", "version"])
@Unique("UQ_ton_jetton_preparation_content_hash", ["contentHash"])
@Index(["dealId", "version"])
@Index(["network", "escrowAddress"])
export class TonJettonEscrowPreparation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  dealId: string;

  @Column({ type: "integer" })
  version: number;

  @Column({ type: "uuid", nullable: true })
  previousPreparationId: string | null;

  @Column({ type: "varchar", length: 64 })
  contentHash: string;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  @Column({ type: "smallint" })
  workchain: number;

  @Column({ type: "varchar", length: 64 })
  codeHash: string;

  @Column({ type: "varchar", length: 64 })
  configHash: string;

  @Column({ type: "varchar", length: 128 })
  escrowAddress: string;

  @Column({ type: "text" })
  stateInit: string;

  @Column({ type: "varchar", length: 128 })
  masterAddress: string;

  @Column({ type: "varchar", length: 64 })
  walletCodeHash: string;

  @Column({ type: "varchar", length: 128 })
  sealedWalletAddress: string;

  @Column({ type: "varchar", length: 64 })
  walletVerificationEvidenceHash: string;

  @Column({ type: "integer" })
  termsVersion: number;

  @Column({ type: "varchar", length: 64 })
  termsHash: string;

  @Column({ type: "integer" })
  quoteVersion: number;

  @Column({ type: "uuid" })
  quoteId: string;

  @Column({ type: "varchar", length: 64 })
  quoteHash: string;

  @Column({ type: "varchar", length: 128 })
  buyerAddress: string;

  @Column({ type: "varchar", length: 128 })
  sellerAddress: string;

  @Column({ type: "varchar", length: 128 })
  arbitratorAddress: string;

  @Column({ type: "varchar", length: 128 })
  treasuryAddress: string;

  @Column({ type: "varchar", length: 128 })
  initializerAddress: string;

  @Column({ type: "varchar", length: 128 })
  reconciliationAddress: string;

  @Column({ type: "varchar", length: 32 })
  assetCode: string;

  @Column({ type: "smallint" })
  assetDecimals: number;

  @Column({ type: "varchar", length: 78 })
  buyerTotalAtomic: string;

  @Column({ type: "varchar", length: 78 })
  sellerPayoutAtomic: string;

  @Column({ type: "varchar", length: 78 })
  platformFeeAtomic: string;

  @Column({ type: "varchar", length: 78 })
  refundToBuyerAtomic: string;

  @Column({ type: "varchar", length: 78 })
  refundFeeAtomic: string;

  @Column({ type: "varchar", length: 20 })
  fundingQueryId: string;

  @Column({ type: "varchar", length: 64 })
  fundingForwardPayloadHash: string;

  @Column({ type: "varchar", length: 20 })
  fundingDeadline: string;

  @Column({ type: "varchar", length: 20 })
  deliveryDeadline: string;

  @Column({ type: "varchar", length: 20 })
  confirmationDeadline: string;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
