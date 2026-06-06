import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Deal } from './deal.entity';
import { User } from '../../user/entities/user.entity';
import { DealEventType, DealStatus } from '../enums/deal.enum';

@Entity('deal_events')
@Index(['dealId'])
@Index(['type'])
@Index(['createdAt'])
@Index(['userId'])
export class DealEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Deal, (deal) => deal.events, {
    onDelete: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal;

  @Column({ type: 'uuid', name: 'deal_id' })
  dealId: string;

  @Column({
    type: 'enum',
    enum: DealEventType,
  })
  type: DealEventType;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  // Статические методы для создания событий
  static createDealCreated(dealId: string, userId: string): Partial<DealEvent> {
    return {
      type: DealEventType.DEAL_CREATED,
      dealId,
      userId,
      description: 'Сделка создана',
    };
  }

  static createCounterpartyInvited(
    dealId: string,
    userId: string,
    invitedEmail?: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.COUNTERPARTY_INVITED,
      dealId,
      userId,
      description: invitedEmail
        ? `Приглашение отправлено на ${invitedEmail}`
        : 'Контрагент приглашён',
      metadata: { invitedEmail },
    };
  }

  static createCounterpartyAccepted(
    dealId: string,
    userId: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.COUNTERPARTY_ACCEPTED,
      dealId,
      userId,
      description: 'Контрагент принял сделку',
    };
  }

  static createCounterpartyRejected(
    dealId: string,
    userId: string,
    reason?: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.COUNTERPARTY_REJECTED,
      dealId,
      userId,
      description: 'Контрагент отклонил сделку',
      metadata: { reason },
    };
  }

  static createPaymentReceived(
    dealId: string,
    amount: number,
    currency: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.PAYMENT_RECEIVED,
      dealId,
      description: `Получена оплата: ${amount} ${currency}`,
      metadata: { amount, currency },
    };
  }

  static createSellerStarted(dealId: string, userId: string): Partial<DealEvent> {
    return {
      type: DealEventType.SELLER_STARTED,
      dealId,
      userId,
      description: 'Продавец начал выполнение',
    };
  }

  static createBuyerConfirmed(dealId: string, userId: string): Partial<DealEvent> {
    return {
      type: DealEventType.BUYER_CONFIRMED,
      dealId,
      userId,
      description: 'Покупатель подтвердил получение',
    };
  }

  static createBuyerRejected(
    dealId: string,
    userId: string,
    reason?: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.BUYER_REJECTED,
      dealId,
      userId,
      description: 'Покупатель отклонил получение',
      metadata: { reason },
    };
  }

  static createDisputeOpened(
    dealId: string,
    userId: string,
    reason: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.DISPUTE_OPENED,
      dealId,
      userId,
      description: 'Открыт спор',
      metadata: { reason },
    };
  }

  static createDisputeResolved(
    dealId: string,
    userId: string,
    decision: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.DISPUTE_RESOLVED,
      dealId,
      userId,
      description: 'Спор решён',
      metadata: { decision },
    };
  }

  static createDealCancelled(
    dealId: string,
    userId: string | null,
    reason?: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.DEAL_CANCELLED,
      dealId,
      userId,
      description: 'Сделка отменена',
      metadata: { reason },
    };
  }

  static createDealRefunded(
    dealId: string,
    userId: string,
    reason?: string,
  ): Partial<DealEvent> {
    return {
      type: DealEventType.DEAL_REFUNDED,
      dealId,
      userId,
      description: 'Средства возвращены',
      metadata: { reason },
    };
  }
}
