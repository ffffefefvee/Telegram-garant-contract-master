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
import { ArbitrationDecisionType } from './enums/arbitration.enum';

@Entity('arbitration_decisions')
@Index(['disputeId'])
@Index(['arbitratorId'])
@Index(['createdAt'])
export class ArbitrationDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Dispute, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute: Dispute;

  @Column({ type: 'uuid', name: 'dispute_id', unique: true })
  disputeId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'arbitrator_id' })
  arbitrator: User;

  @Column({ type: 'uuid', name: 'arbitrator_id' })
  arbitratorId: string;

  @Column({
    type: 'enum',
    enum: ArbitrationDecisionType,
  })
  decisionType: ArbitrationDecisionType;

  @Column({ type: 'text' })
  reasoning: string;

  @Column({ type: 'text', nullable: true })
  comments: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  refundToBuyer: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  paymentToSeller: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  penaltyAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  arbitratorFee: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  platformFee: number;

  @Column({ type: 'text', nullable: true })
  penaltyReason: string | null;

  @Column({ type: 'boolean', default: false })
  isAppealable: boolean;

  @Column({ type: 'int', default: 24 })
  appealPeriodHours: number;

  @Column({ type: 'boolean', default: false })
  isEnforced: boolean;

  @Column({ type: 'timestamp', nullable: true })
  enforcedAt: Date | null;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'enforced_by_id' })
  enforcedBy: User | null;

  @Column({ type: 'uuid', name: 'enforced_by_id', nullable: true })
  enforcedById: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isFinal(): boolean {
    return this.isEnforced || !this.isAppealable;
  }

  get canBeAppealed(): boolean {
    if (!this.isAppealable) return false;
    if (this.isEnforced) return false;
    
    const appealDeadline = new Date(this.createdAt.getTime() + this.appealPeriodHours * 60 * 60 * 1000);
    return new Date() < appealDeadline;
  }

  get buyerWins(): boolean {
    return [
      ArbitrationDecisionType.FULL_REFUND_TO_BUYER,
      ArbitrationDecisionType.PARTIAL_REFUND_TO_BUYER,
    ].includes(this.decisionType);
  }

  get sellerWins(): boolean {
    return [
      ArbitrationDecisionType.FULL_PAYMENT_TO_SELLER,
      ArbitrationDecisionType.PARTIAL_PAYMENT_TO_SELLER,
    ].includes(this.decisionType);
  }

  get isSplit(): boolean {
    return this.decisionType === ArbitrationDecisionType.SPLIT_FUNDS;
  }

  // Методы
  enforce(userId: string): void {
    this.isEnforced = true;
    this.enforcedAt = new Date();
    this.enforcedById = userId;
  }

  // Статические методы
  static calculateDistribution(
    dealAmount: number,
    decisionType: ArbitrationDecisionType,
    penaltyPercent: number = 0,
  ): { refundToBuyer: number; paymentToSeller: number; penalty: number } {
    let refundToBuyer = 0;
    let paymentToSeller = 0;
    let penalty = 0;

    switch (decisionType) {
      case ArbitrationDecisionType.FULL_REFUND_TO_BUYER:
        refundToBuyer = dealAmount;
        paymentToSeller = 0;
        penalty = dealAmount * penaltyPercent;
        break;

      case ArbitrationDecisionType.PARTIAL_REFUND_TO_BUYER:
        refundToBuyer = dealAmount * 0.5;
        paymentToSeller = dealAmount * 0.5;
        penalty = paymentToSeller * penaltyPercent;
        paymentToSeller -= penalty;
        break;

      case ArbitrationDecisionType.FULL_PAYMENT_TO_SELLER:
        refundToBuyer = 0;
        paymentToSeller = dealAmount;
        penalty = dealAmount * penaltyPercent;
        paymentToSeller -= penalty;
        break;

      case ArbitrationDecisionType.PARTIAL_PAYMENT_TO_SELLER:
        refundToBuyer = dealAmount * 0.3;
        paymentToSeller = dealAmount * 0.7;
        penalty = paymentToSeller * penaltyPercent;
        paymentToSeller -= penalty;
        break;

      case ArbitrationDecisionType.SPLIT_FUNDS:
        refundToBuyer = dealAmount * 0.5;
        paymentToSeller = dealAmount * 0.5;
        break;

      case ArbitrationDecisionType.REFUND_NO_PENALTY:
        refundToBuyer = dealAmount;
        paymentToSeller = 0;
        break;
    }

    return {
      refundToBuyer: Math.round(refundToBuyer * 100) / 100,
      paymentToSeller: Math.round(paymentToSeller * 100) / 100,
      penalty: Math.round(penalty * 100) / 100,
    };
  }
}
