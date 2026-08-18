import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./user.entity";

/**
 * A short-lived, single-use TON Connect proof nonce.
 *
 * Only the SHA-256 digest is stored. A database transaction consumes the row
 * together with the wallet binding, so concurrent replay attempts cannot both
 * succeed.
 */
@Entity("ton_proof_challenges")
@Index(["userId", "expiresAt"])
export class TonProofChallenge {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @Column({ type: "varchar", length: 64, unique: true })
  payloadHash: string;

  @Column({ type: "timestamp" })
  expiresAt: Date;

  @Column({ type: "timestamp", nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
