import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Deal } from '../../deal/entities/deal.entity';

/**
 * Условия сделки для арбитража
 * Стороны указывают эти условия при создании сделки
 * для более лёгкого разрешения споров
 */
@Entity('deal_terms')
@Index(['dealId'])
export class DealTerms {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Deal, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal;

  @Column({ type: 'uuid', name: 'deal_id', unique: true })
  dealId: string;

  @Column({ type: 'text', nullable: true })
  acceptanceCriteria: string | null;
  // Критерии приёмки: "Товар должен работать 7 дней без сбоев"

  @Column({ type: 'text', nullable: true })
  requiredEvidence: string | null;
  // JSON array: ["скриншоты", "видео", "логи"]

  @Column({ type: 'int', default: 24 })
  studyPeriodHours: number;
  // Срок проверки в часах (24, 48, 72)

  @Column({ type: 'text', nullable: true })
  customConditions: string | null;
  // Особые условия: "Продавец предоставляет инструкцию"

  @Column({ type: 'text', nullable: true })
  deliveryMethod: string | null;
  // Способ доставки: "Email", "Telegram", "Курьер", "СДЭК"

  @Column({ type: 'text', nullable: true })
  deliveryTimeframe: string | null;
  // Сроки доставки: "В течение 24 часов после оплаты"

  @Column({ type: 'text', nullable: true })
  warrantyTerms: string | null;
  // Гарантийные условия: "Гарантия 30 дней"

  @Column({ type: 'boolean', default: false })
  hasWarranty: boolean;

  @Column({ type: 'int', nullable: true })
  warrantyDays: number | null;

  @Column({ type: 'text', nullable: true })
  refundPolicy: string | null;
  // Условия возврата: "Возврат в течение 14 дней если товар не работает"

  @Column({ type: 'boolean', default: false })
  isRefundable: boolean;

  @Column({ type: 'int', nullable: true })
  refundDays: number | null;

  @Column({ type: 'text', nullable: true })
  additionalNotes: string | null;
  // Дополнительные заметки

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get evidenceList(): string[] {
    if (!this.requiredEvidence) return [];
    try {
      return JSON.parse(this.requiredEvidence);
    } catch {
      return [];
    }
  }

  get warrantyPeriodDays(): number {
    return this.hasWarranty && this.warrantyDays ? this.warrantyDays : 0;
  }

  get refundPeriodDays(): number {
    return this.isRefundable && this.refundDays ? this.refundDays : 0;
  }

  // Методы
  validate(): boolean {
    // Проверка что studyPeriodHours в допустимых пределах
    if (this.studyPeriodHours < 1 || this.studyPeriodHours > 720) {
      return false;
    }
    return true;
  }

  // Статические методы
  static createDefault(dealId: string): Partial<DealTerms> {
    return {
      dealId,
      studyPeriodHours: 24,
      hasWarranty: false,
      isRefundable: false,
    };
  }
}
