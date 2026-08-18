import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { TonNativeLifecycleAction } from "../ton-native-lifecycle";

/** Immutable action body issued to a participant wallet. */
@Entity("ton_native_lifecycle_intents")
@Unique("UQ_ton_native_lifecycle_intent_state_action", [
  "preparationId",
  "action",
  "expectedFromStatus",
  "requesterUserId",
])
@Index(["dealId", "createdAt"])
export class TonNativeLifecycleIntent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  preparationId: string;

  @Column({ type: "uuid" })
  dealId: string;

  @Column({ type: "varchar", length: 40 })
  action: TonNativeLifecycleAction;

  @Column({ type: "smallint" })
  expectedFromStatus: number;

  @Column({ type: "smallint" })
  expectedToStatus: number;

  @Column({ type: "uuid" })
  requesterUserId: string;

  @Column({ type: "varchar", length: 128 })
  senderAddress: string;

  @Column({ type: "varchar", length: 20, unique: true })
  queryId: string;

  @Column({ type: "varchar", length: 78 })
  actionValueAtomic: string;

  @Column({ type: "text" })
  payload: string;

  @Column({ type: "varchar", length: 64 })
  payloadHash: string;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @Column({ type: "uuid", nullable: true })
  decisionId: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  decisionHash: string | null;

  @Column({ type: "varchar", length: 78, nullable: true })
  buyerAwardAtomic: string | null;

  @Column({ type: "varchar", length: 78, nullable: true })
  sellerAwardAtomic: string | null;

  @Column({ type: "uuid", nullable: true })
  consumedByEventId: string | null;

  @Column({ type: "timestamp", nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}
