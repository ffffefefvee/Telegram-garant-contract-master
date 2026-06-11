import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { DealType, DealStatus, DealSide, Currency, DealSubcategory, FeeModel } from '../enums/deal.enum';
import { DealMessage } from './deal-message.entity';
import { DealAttachment } from './deal-attachment.entity';
import { DealInvite } from './deal-invite.entity';
import { DealEvent } from './deal-event.entity';

@Entity('deals')
@Index(['buyerId'])
@Index(['sellerId'])
@Index(['type'])
@Index(['createdAt'])
export class Deal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  dealNumber: string;

  @Column({
    type: 'enum',
    enum: DealType,
  })
  type: DealType;

  /**
   * Подкатегория цифрового товара (D3). null для non-digital типов (Phase 2+).
   */
  @Column({ type: 'enum', enum: DealSubcategory, nullable: true })
  subcategory: DealSubcategory | null;

  @Column({
    type: 'enum',
    enum: DealStatus,
    default: DealStatus.DRAFT,
  })
  @Index()
  status: DealStatus;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @Column({ type: 'uuid', name: 'buyer_id' })
  buyerId: string;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn({ name: 'seller_id' })
  seller: User | null;

  @Column({ type: 'uuid', name: 'seller_id', nullable: true })
  sellerId: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: Currency,
    default: Currency.RUB,
  })
  currency: Currency;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  commissionRate: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  commissionAmount: number;

  /**
   * Цена в валюте котировки (RUB или USDT), введённая пользователем (§9).
   */
  @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
  quoteAmount: number | null;

  /**
   * Валюта котировки: 'RUB' или 'USDT' (§9).
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  quoteCurrency: 'RUB' | 'USDT' | null;

  /**
   * Зафиксированный USDT-эквивалент суммы сделки, устанавливается при funding (§9).
   */
  @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
  amountUsdt: number | null;

  /**
   * Момент фиксации курса RUB/USDT (§9).
   */
  @Column({ type: 'timestamp', nullable: true })
  fxRateLockedAt: Date | null;

  /**
   * Модель распределения комиссии (D4): SPLIT_50_50 / BUYER_PAYS / SELLER_PAYS.
   */
  @Column({ type: 'enum', enum: FeeModel, default: FeeModel.BUYER_PAYS })
  feeModel: FeeModel;

  /**
   * Доля комиссии, которую платит покупатель (в USDT, D5).
   */
  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 })
  feeBuyerUsdt: number;

  /**
   * Доля комиссии, которую платит продавец (в USDT, D5).
   */
  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 })
  feeSellerUsdt: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  terms: string | null;

  @Column({ type: 'timestamp', nullable: true })
  deadline: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isPublic: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  publicSlug: string | null;

  @OneToMany(() => DealMessage, (message) => message.deal, { cascade: true })
  messages: DealMessage[];

  @OneToMany(() => DealAttachment, (attachment) => attachment.deal, { cascade: true })
  attachments: DealAttachment[];

  @OneToMany(() => DealInvite, (invite) => invite.deal, { cascade: true })
  invites: DealInvite[];

  @OneToMany(() => DealEvent, (event) => event.deal, { cascade: true })
  events: DealEvent[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  disputedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  arbitratorId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancelReason: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  refundReason: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'escrow_address' })
  escrowAddress: string | null;

  // Геттеры для вычисляемых полей

  get totalAmount(): number {
    return this.amount + this.commissionAmount;
  }

  /**
   * Итоговая сумма, которую платит покупатель (с учётом feeModel D4).
   * Если USDT-суммы зафиксированы, используем их, иначе fallback на legacy поля.
   */
  get buyerPays(): number {
    if (this.amountUsdt !== null && this.amountUsdt !== undefined) {
      return Number(this.amountUsdt) + Number(this.feeBuyerUsdt ?? 0);
    }
    switch (this.feeModel) {
      case FeeModel.SELLER_PAYS:
        return this.amount;
      case FeeModel.SPLIT_50_50:
        return this.amount + this.commissionAmount / 2;
      case FeeModel.BUYER_PAYS:
      default:
        return this.amount + this.commissionAmount;
    }
  }

  /**
   * Сумма, которую получает продавец (с учётом feeModel D4).
   */
  get sellerReceives(): number {
    if (this.amountUsdt !== null && this.amountUsdt !== undefined) {
      return Number(this.amountUsdt) - Number(this.feeSellerUsdt ?? 0);
    }
    switch (this.feeModel) {
      case FeeModel.BUYER_PAYS:
        return this.amount;
      case FeeModel.SPLIT_50_50:
        return this.amount - this.commissionAmount / 2;
      case FeeModel.SELLER_PAYS:
      default:
        return this.amount - this.commissionAmount;
    }
  }

  get isExpired(): boolean {
    if (!this.deadline) return false;
    return new Date() > this.deadline && this.status !== DealStatus.COMPLETED;
  }

  get canBeCancelled(): boolean {
    return [
      DealStatus.DRAFT,
      DealStatus.PENDING_ACCEPTANCE,
      DealStatus.PENDING_PAYMENT,
    ].includes(this.status);
  }

  get canBeConfirmed(): boolean {
    return this.status === DealStatus.PENDING_CONFIRMATION;
  }

  get canBeDisputed(): boolean {
    return [
      DealStatus.IN_PROGRESS,
      DealStatus.PENDING_CONFIRMATION,
    ].includes(this.status);
  }

  get activeSide(): DealSide | null {
    switch (this.status) {
      case DealStatus.PENDING_PAYMENT:
        return DealSide.BUYER;
      case DealStatus.IN_PROGRESS:
        return DealSide.SELLER;
      case DealStatus.PENDING_CONFIRMATION:
        return DealSide.BUYER;
      default:
        return null;
    }
  }

  // Методы для изменения статуса
  canTransitionTo(newStatus: DealStatus): boolean {
    const transitions: Record<DealStatus, DealStatus[]> = {
      [DealStatus.DRAFT]: [DealStatus.PENDING_ACCEPTANCE, DealStatus.CANCELLED],
      [DealStatus.PENDING_ACCEPTANCE]: [
        DealStatus.IN_PROGRESS,
        DealStatus.PENDING_PAYMENT,
        DealStatus.CANCELLED,
      ],
      [DealStatus.PENDING_PAYMENT]: [
        DealStatus.IN_PROGRESS,
        DealStatus.CANCELLED,
        DealStatus.REFUNDED,
      ],
      [DealStatus.IN_PROGRESS]: [
        DealStatus.PENDING_CONFIRMATION,
        DealStatus.DISPUTED,
        DealStatus.FROZEN,
      ],
      [DealStatus.PENDING_CONFIRMATION]: [
        DealStatus.COMPLETED,
        DealStatus.DISPUTED,
        DealStatus.REFUNDED,
      ],
      [DealStatus.COMPLETED]: [],
      [DealStatus.CANCELLED]: [],
      [DealStatus.REFUNDED]: [],
      [DealStatus.DISPUTED]: [DealStatus.DISPUTE_RESOLVED, DealStatus.FROZEN],
      [DealStatus.DISPUTE_RESOLVED]: [DealStatus.COMPLETED, DealStatus.REFUNDED],
      [DealStatus.FROZEN]: [DealStatus.IN_PROGRESS, DealStatus.REFUNDED],
    };

    return transitions[this.status]?.includes(newStatus) || false;
  }

  getStatusProgress(): number {
    const statusOrder = [
      DealStatus.DRAFT,
      DealStatus.PENDING_ACCEPTANCE,
      DealStatus.PENDING_PAYMENT,
      DealStatus.IN_PROGRESS,
      DealStatus.PENDING_CONFIRMATION,
      DealStatus.COMPLETED,
    ];

    const index = statusOrder.indexOf(this.status);
    if (index === -1) return 0;

    return Math.round((index / (statusOrder.length - 1)) * 100);
  }
}
