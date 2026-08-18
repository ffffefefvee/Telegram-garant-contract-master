import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Deal } from "./deal.entity";
import { TonNetwork } from "../../user/entities/ton-wallet-binding.entity";

/** Immutable server-side snapshot used to derive a native TON escrow. */
@Entity("ton_native_escrow_preparations")
export class TonNativeEscrowPreparation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", unique: true })
  @Index()
  dealId: string;

  @OneToOne(() => Deal, { onDelete: "CASCADE" })
  @JoinColumn({ name: "dealId" })
  deal: Deal;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  @Column({ type: "varchar", length: 16 })
  chainId: string;

  @Column({ type: "varchar", length: 64 })
  termsHash: string;

  @Column({ type: "varchar", length: 64, unique: true })
  quoteHash: string;

  @Column({ type: "varchar", length: 64 })
  codeHash: string;

  @Column({ type: "varchar", length: 64 })
  configHash: string;

  @Column({ type: "varchar", length: 128 })
  escrowAddress: string;

  @Column({ type: "varchar", length: 128 })
  buyerAddress: string;

  @Column({ type: "varchar", length: 128 })
  sellerAddress: string;

  @Column({ type: "varchar", length: 128 })
  arbitratorAddress: string;

  @Column({ type: "varchar", length: 128 })
  treasuryAddress: string;

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

  @Column({ type: "varchar", length: 78 })
  requestAmountAtomic: string;

  @Column({ type: "varchar", length: 20 })
  queryId: string;

  @Column({ type: "varchar", length: 20 })
  fundingDeadline: string;

  @Column({ type: "varchar", length: 20 })
  deliveryDeadline: string;

  @Column({ type: "varchar", length: 20 })
  confirmationDeadline: string;

  @Column({ type: "text" })
  stateInit: string;

  @Column({ type: "text" })
  payload: string;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
