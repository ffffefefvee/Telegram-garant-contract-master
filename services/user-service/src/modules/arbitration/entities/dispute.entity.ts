import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  Index,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Deal } from '../../deal/entities/deal.entity';
import {
  DisputeStatus,
  DisputeType,
  DisputeSide,
  ArbitrationDecisionType,
} from './enums/arbitration.enum';
import { Evidence } from './evidence.entity';
import { ArbitrationChat } from './arbitration-chat.entity';
import { ArbitrationDecision } from './arbitration-decision.entity';
import { ArbitrationEvent } from './arbitration-event.entity';
import { Appeal } from './appeal.entity';

@Entity('disputes')
@Index(['dealId'])
@Index(['openerId'])
@Index(['status'])
@Index(['type'])
@Index(['createdAt'])
@Index(['arbitratorId'])
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  disputeNumber: string;

  @ManyToOne(() => Deal, { eager: false })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal;

  @Column({ type: 'uuid', name: 'deal_id' })
  dealId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'opener_id' })
  opener: User;

  @Column({ type: 'uuid', name: 'opener_id' })
  openerId: string;

  @Column({
    type: 'enum',
    enum: DisputeSide,
  })
  openedBy: DisputeSide;

  @Column({
    type: 'enum',
    enum: DisputeType,
  })
  type: DisputeType;

@Column({
    type: 'enum',
    enum: DisputeStatus,
    default: DisputeStatus.OPENED,
  })
  status: DisputeStatus;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  claimedAmount: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  penaltyPercent: number | null;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'arbitrator_id' })
  arbitrator: User | null;

  @Column({ type: 'uuid', name: 'arbitrator_id', nullable: true })
  arbitratorId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  arbitratorAssignedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  sellerResponseDueAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  evidenceDueAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  decisionDueAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  appealDueAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  enforcedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  resolution: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  penaltyAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  arbitratorFee: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  platformFee: number;

  @Column({ type: 'boolean', default: false })
  isAppealable: boolean;

  @Column({ type: 'timestamp', nullable: true })
  appealedAt: Date | null;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'appeal_arbitrator_id' })
  appealArbitrator: User | null;

  @Column({ type: 'uuid', name: 'appeal_arbitrator_id', nullable: true })
  appealArbitratorId: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Relations
  @OneToMany(() => Evidence, (evidence) => evidence.dispute, { cascade: true })
  evidence: Evidence[];

  @OneToOne(() => ArbitrationChat, (chat) => chat.dispute, { cascade: true })
  @JoinColumn({ name: 'chat_id' })
  chat: ArbitrationChat | null;

  @Column({ type: 'uuid', name: 'chat_id', nullable: true })
  chatId: string | null;

  @OneToOne(() => ArbitrationDecision, (decision) => decision.dispute, { cascade: true })
  @JoinColumn({ name: 'decision_id' })
  decision: ArbitrationDecision | null;

  @Column({ type: 'uuid', name: 'decision_id', nullable: true })
  decisionId: string | null;

  @OneToMany(() => ArbitrationEvent, (event) => event.dispute, { cascade: true })
  events: ArbitrationEvent[];

  @OneToOne(() => Appeal, (appeal) => appeal.dispute, { cascade: true })
  @JoinColumn({ name: 'appeal_id' })
  appeal: Appeal | null;

  @Column({ type: 'uuid', name: 'appeal_id', nullable: true })
  appealId: string | null;

  // Геттеры
  get isOpen(): boolean {
    return [
      DisputeStatus.OPENED,
      DisputeStatus.WAITING_SELLER_RESPONSE,
      DisputeStatus.WAITING_BUYER_EVIDENCE,
      DisputeStatus.WAITING_SELLER_EVIDENCE,
      DisputeStatus.PENDING_ARBITRATOR,
    ].includes(this.status);
  }

  get isUnderReview(): boolean {
    return this.status === DisputeStatus.UNDER_REVIEW;
  }

  get isDecided(): boolean {
    return this.status === DisputeStatus.DECISION_MADE;
  }

  get isAppealed(): boolean {
    return this.status === DisputeStatus.APPEALED;
  }

  get isClosed(): boolean {
    return [DisputeStatus.ENFORCED, DisputeStatus.CLOSED].includes(this.status);
  }

  get canTransitionToAppeal(): boolean {
    return this.isDecided && !this.isAppealed && !this.isClosed;
  }

  get opponentId(): string | null {
    if (!this.deal) return null;
    return this.openedBy === DisputeSide.BUYER ? this.deal.sellerId : this.deal.buyerId;
  }

  // Методы для изменения статуса
  canTransitionTo(newStatus: DisputeStatus): boolean {
    const transitions: Record<DisputeStatus, DisputeStatus[]> = {
      [DisputeStatus.OPENED]: [
        DisputeStatus.WAITING_SELLER_RESPONSE,
        DisputeStatus.WAITING_BUYER_EVIDENCE,
        DisputeStatus.PENDING_ARBITRATOR,
        DisputeStatus.CLOSED,
      ],
      [DisputeStatus.WAITING_SELLER_RESPONSE]: [
        DisputeStatus.WAITING_BUYER_EVIDENCE,
        DisputeStatus.WAITING_SELLER_EVIDENCE,
        DisputeStatus.PENDING_ARBITRATOR,
        DisputeStatus.CLOSED,
      ],
      [DisputeStatus.WAITING_BUYER_EVIDENCE]: [
        DisputeStatus.WAITING_SELLER_EVIDENCE,
        DisputeStatus.PENDING_ARBITRATOR,
        DisputeStatus.UNDER_REVIEW,
      ],
      [DisputeStatus.WAITING_SELLER_EVIDENCE]: [
        DisputeStatus.PENDING_ARBITRATOR,
        DisputeStatus.UNDER_REVIEW,
      ],
      [DisputeStatus.PENDING_ARBITRATOR]: [
        DisputeStatus.UNDER_REVIEW,
        DisputeStatus.CLOSED,
      ],
      [DisputeStatus.UNDER_REVIEW]: [
        DisputeStatus.DECISION_MADE,
        DisputeStatus.CLOSED,
      ],
      [DisputeStatus.DECISION_MADE]: [
        DisputeStatus.APPEAL_PERIOD,
        DisputeStatus.APPEALED,
        DisputeStatus.ENFORCED,
        DisputeStatus.CLOSED,
      ],
      [DisputeStatus.APPEAL_PERIOD]: [
        DisputeStatus.APPEALED,
        DisputeStatus.ENFORCED,
        DisputeStatus.CLOSED,
      ],
      [DisputeStatus.APPEALED]: [
        DisputeStatus.UNDER_REVIEW,
        DisputeStatus.DECISION_MADE,
        DisputeStatus.ENFORCED,
        DisputeStatus.CLOSED,
      ],
      [DisputeStatus.ENFORCED]: [DisputeStatus.CLOSED],
      [DisputeStatus.CLOSED]: [],
    };

    return transitions[this.status]?.includes(newStatus) || false;
  }

  // Статические методы
  static generateDisputeNumber(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `DSP-${timestamp}-${random}`;
  }
}
