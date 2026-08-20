import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./user.entity";

export enum TonNetwork {
  MAINNET = "-239",
  TESTNET = "-3",
}

/** A TON address whose ownership has been verified with TON Connect ton_proof. */
@Entity("ton_wallet_bindings")
@Unique(["userId", "network"])
@Unique(["network", "address"])
export class TonWalletBinding {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @Column({ type: "varchar", length: 16 })
  network: TonNetwork;

  /** Canonical raw address (`workchain:64-lowercase-hex`). */
  @Column({ type: "varchar", length: 128 })
  address: string;

  /** StateInit-derived Ed25519 key; never trusted directly from the client. */
  @Column({ type: "varchar", length: 64 })
  publicKey: string;

  /** Base64 BoC retained to make the verification evidence auditable. */
  @Column({ type: "text" })
  walletStateInit: string;

  @Column({ type: "timestamp" })
  verifiedAt: Date;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;
}
