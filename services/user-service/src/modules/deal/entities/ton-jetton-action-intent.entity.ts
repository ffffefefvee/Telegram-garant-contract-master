import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";

export enum TonJettonAction {
  MARK_DELIVERED = "mark_delivered",
  RELEASE = "release",
  OPEN_DISPUTE = "open_dispute",
  REFUND_BUYER = "refund_buyer",
  REFUND_AFTER_SELLER_TIMEOUT = "refund_after_seller_timeout",
  RELEASE_AFTER_BUYER_TIMEOUT = "release_after_buyer_timeout",
  RESOLVE = "resolve",
  RECONCILE_ATTEMPT = "reconcile_attempt",
  RETRY_FAILED_LEGS = "retry_failed_legs",
  FINALIZE_SETTLEMENT = "finalize_settlement",
}

/** Immutable action body issued to a participant or reconciliation authority. */
@Entity("ton_jetton_action_intents")
@Unique("UQ_ton_jetton_intent_preparation_query", ["preparationId", "queryId"])
@Index(["dealId", "createdAt"])
export class TonJettonActionIntent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  preparationId: string;

  @Column({ type: "uuid" })
  dealId: string;

  @Column({ type: "varchar", length: 40 })
  action: TonJettonAction;

  @Column({ type: "varchar", length: 32 })
  expectedFromStatus: string;

  @Column({ type: "varchar", length: 32 })
  expectedToStatus: string;

  @Column({ type: "varchar", length: 128 })
  requesterId: string;

  @Column({ type: "varchar", length: 128 })
  senderAddress: string;

  @Column({ type: "varchar", length: 20 })
  queryId: string;

  @Column({ type: "text" })
  payload: string;

  @Column({ type: "varchar", length: 64 })
  payloadHash: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  settlementId: string | null;

  @Column({ type: "varchar", length: 78, nullable: true })
  buyerAwardAtomic: string | null;

  @Column({ type: "varchar", length: 78, nullable: true })
  sellerAwardAtomic: string | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;
}

/** Append-only consumption marker; the action body itself never changes. */
@Entity("ton_jetton_action_intent_consumptions")
@Unique("UQ_ton_jetton_intent_consumption_event", ["eventId"])
export class TonJettonActionIntentConsumption {
  @PrimaryColumn({ type: "uuid" })
  intentId: string;

  @OneToOne(() => TonJettonActionIntent, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "intentId" })
  intent: TonJettonActionIntent;

  @Column({ type: "uuid" })
  eventId: string;

  @CreateDateColumn({ type: "timestamp" })
  consumedAt: Date;
}
