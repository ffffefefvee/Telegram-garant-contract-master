import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  Index,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Deal } from '../../deal/entities/deal.entity';
import { PaymentType, PaymentStatus, PaymentMethod } from '../enums/payment.enum';

@Entity('payments')
@Index(['userId'])
@Index(['dealId'])
@Index(['type'])
@Index(['createdAt'])
@Unique(['transactionId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  transactionId: string;

  @Column({
    type: 'enum',
    enum: PaymentType,
  })
  type: PaymentType;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  @Index()
  status: PaymentStatus;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => Deal, { eager: false, nullable: true })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal | null;

  @Column({ type: 'uuid', name: 'deal_id', nullable: true })
  dealId: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'RUB' })
  currency: string;

  @Column({ type: 'decimal', precision: 12, scale: 8, nullable: true })
  cryptoAmount: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  cryptoCurrency: string | null;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
    default: PaymentMethod.CRYPTOMUS,
  })
  paymentMethod: PaymentMethod;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  fee: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  paymentUrl: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  walletAddress: string | null;

  @Column({ type: 'jsonb', default: {} })
  cryptomusData: Record<string, any>;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  txId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  escrowAddress: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  failureReason: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  refundReason: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  refundedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  refundedBy: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isPending(): boolean {
    return this.status === PaymentStatus.PENDING;
  }

  get isCompleted(): boolean {
    return this.status === PaymentStatus.COMPLETED;
  }

  get isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt && this.status === PaymentStatus.PENDING;
  }

  get canBePaid(): boolean {
    return this.status === PaymentStatus.PENDING && !this.isExpired;
  }

  get totalAmount(): number {
    return this.amount + this.fee;
  }

  // Методы
  markAsCompleted(data?: Record<string, any>): void {
    this.status = PaymentStatus.COMPLETED;
    this.paidAt = new Date();
    if (data) {
      this.cryptomusData = { ...this.cryptomusData, ...data };
    }
  }

  markAsFailed(reason: string): void {
    this.status = PaymentStatus.FAILED;
    this.failureReason = reason;
  }

  markAsExpired(): void {
    this.status = PaymentStatus.EXPIRED;
  }

  markAsRefunded(reason: string, refundedBy: string): void {
    this.status = PaymentStatus.REFUNDED;
    this.refundReason = reason;
    this.refundedBy = refundedBy;
    this.refundedAt = new Date();
  }

  // Статические методы
  static generateTransactionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `PAY_${timestamp}_${random}`;
  }

  static calculateFee(amount: number, rate: number = 0.05): number {
    return Math.round(amount * rate * 100) / 100;
  }
}
