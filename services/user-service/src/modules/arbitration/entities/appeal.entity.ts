import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Dispute } from './dispute.entity';
import { User } from '../../user/entities/user.entity';
import { ArbitrationDecision } from './arbitration-decision.entity';

@Entity('appeals')
@Index(['disputeId'])
@Index(['appellantId'])
@Index(['status'])
@Index(['createdAt'])
export class Appeal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Dispute, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute: Dispute;

  @Column({ type: 'uuid', name: 'dispute_id', unique: true })
  disputeId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'appellant_id' })
  appellant: User;

  @Column({ type: 'uuid', name: 'appellant_id' })
  appellantId: string;

  @ManyToOne(() => ArbitrationDecision, { eager: false })
  @JoinColumn({ name: 'original_decision_id' })
  originalDecision: ArbitrationDecision;

  @Column({ type: 'uuid', name: 'original_decision_id' })
  originalDecisionId: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'text', nullable: true })
  newEvidence: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  depositAmount: number | null; // Залог апелляции

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'withdrawn';

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer: User | null; // Старший арбитр

  @Column({ type: 'uuid', name: 'reviewer_id', nullable: true })
  reviewerId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewerAssignedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewDecision: string | null;

  @Column({ type: 'boolean', default: false })
  isDepositRefunded: boolean;

  @Column({ type: 'timestamp', nullable: true })
  depositRefundedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isPending(): boolean {
    return this.status === 'pending';
  }

  get isUnderReview(): boolean {
    return this.status === 'under_review';
  }

  get isDecided(): boolean {
    return ['approved', 'rejected'].includes(this.status);
  }

  get isWithdrawn(): boolean {
    return this.status === 'withdrawn';
  }

  get canBeWithdrawn(): boolean {
    return this.isPending && !this.isDecided;
  }

  // Методы
  assignReviewer(reviewerId: string): void {
    this.reviewerId = reviewerId;
    this.reviewerAssignedAt = new Date();
    this.status = 'under_review';
  }

  approve(decision: string, refundDeposit: boolean = true): void {
    this.status = 'approved';
    this.reviewDecision = decision;
    this.reviewedAt = new Date();
    if (refundDeposit && this.depositAmount) {
      this.isDepositRefunded = true;
      this.depositRefundedAt = new Date();
    }
  }

  reject(decision: string, refundDeposit: boolean = false): void {
    this.status = 'rejected';
    this.reviewDecision = decision;
    this.reviewedAt = new Date();
    if (refundDeposit && this.depositAmount) {
      this.isDepositRefunded = true;
      this.depositRefundedAt = new Date();
    }
  }

  withdraw(): void {
    this.status = 'withdrawn';
    // Залог возвращается при отзыве
    if (this.depositAmount) {
      this.isDepositRefunded = true;
      this.depositRefundedAt = new Date();
    }
  }
}
