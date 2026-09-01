import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../enums/deal.enum";

@Entity("settlement_quotes")
@Unique("UQ_settlement_quote_deal_version", ["dealId", "version"])
@Unique("UQ_settlement_quote_deal_hash", ["dealId", "hash"])
@Index("IDX_settlement_quote_identity", ["network", "chainId", "asset"])
export class SettlementQuote {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "deal_id" })
  dealId: string;

  @Column({ type: "smallint", name: "domain_version" })
  domainVersion: number;

  @Column({ type: "integer" })
  version: number;

  @Column({ type: "integer", name: "terms_version" })
  termsVersion: number;

  @Column({ type: "varchar", length: 64, name: "terms_hash" })
  termsHash: string;

  @Column({ type: "varchar", length: 24, name: "fee_model" })
  feeModel: FeeModel;

  @Column({ type: "varchar", length: 16 })
  network: SettlementNetwork;

  @Column({ type: "varchar", length: 64, name: "chain_id" })
  chainId: string;

  @Column({ type: "varchar", length: 32 })
  asset: SettlementAsset;

  @Column({
    type: "varchar",
    length: 128,
    nullable: true,
    name: "asset_contract",
  })
  assetContract: string | null;

  @Column({ type: "smallint" })
  decimals: number;

  @Column({ type: "varchar", length: 78, name: "amount_atomic" })
  amountAtomic: string;

  @Column({ type: "varchar", length: 78, name: "buyer_fee_atomic" })
  buyerFeeAtomic: string;

  @Column({ type: "varchar", length: 78, name: "seller_fee_atomic" })
  sellerFeeAtomic: string;

  @Column({ type: "varchar", length: 78, name: "total_funding_atomic" })
  totalFundingAtomic: string;

  @Column({ type: "varchar", length: 78, name: "seller_receives_atomic" })
  sellerReceivesAtomic: string;

  @Column({ type: "timestamp with time zone", name: "quoted_at" })
  quotedAt: Date;

  @Column({ type: "timestamp with time zone", name: "expires_at" })
  expiresAt: Date;

  @Column({ type: "varchar", length: 64 })
  hash: string;

  @CreateDateColumn({ type: "timestamp with time zone", name: "created_at" })
  createdAt: Date;
}

@Entity("settlement_confirmations")
@Unique("UQ_settlement_confirmation_quote_party", ["quoteId", "party"])
@Index("IDX_settlement_confirmation_deal_quote", ["dealId", "quoteId"])
export class SettlementConfirmationRecord {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", name: "deal_id" })
  dealId: string;

  @Column({ type: "uuid", name: "quote_id" })
  quoteId: string;

  @Column({ type: "varchar", length: 8 })
  party: "buyer" | "seller";

  @Column({ type: "uuid", name: "user_id" })
  userId: string;

  @Column({ type: "smallint", name: "domain_version" })
  domainVersion: number;

  @Column({ type: "integer", name: "terms_version" })
  termsVersion: number;

  @Column({ type: "varchar", length: 64, name: "terms_hash" })
  termsHash: string;

  @Column({ type: "integer", name: "quote_version" })
  quoteVersion: number;

  @Column({ type: "varchar", length: 64, name: "quote_hash" })
  quoteHash: string;

  @Column({ type: "varchar", length: 16 })
  network: SettlementNetwork;

  @Column({ type: "varchar", length: 64, name: "chain_id" })
  chainId: string;

  @Column({ type: "varchar", length: 32 })
  asset: SettlementAsset;

  @CreateDateColumn({ type: "timestamp with time zone", name: "confirmed_at" })
  confirmedAt: Date;
}
