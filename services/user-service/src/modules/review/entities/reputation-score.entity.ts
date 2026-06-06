import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Deal } from '../../deal/entities/deal.entity';
import { ReputationEventType } from '../enums/review.enum';

@Entity('reputation_scores')
@Index(['userId'])
@Index(['type'])
@Index(['createdAt'])
export class ReputationScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @Column({
    type: 'enum',
    enum: ReputationEventType,
  })
  type: ReputationEventType;

  @Column({ type: 'int' })
  scoreDelta: number;

  @Column({ type: 'int' })
  scoreBefore: number;

  @Column({ type: 'int' })
  scoreAfter: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isPositive(): boolean {
    return this.scoreDelta > 0;
  }

  get isNegative(): boolean {
    return this.scoreDelta < 0;
  }

  // Статические методы
  static createScoreChange(
    userId: string,
    type: ReputationEventType,
    delta: number,
    currentScore: number,
    description?: string,
    reason?: string,
  ): Partial<ReputationScore> {
    return {
      userId,
      type,
      scoreDelta: delta,
      scoreBefore: currentScore,
      scoreAfter: Math.max(0, Math.min(100, currentScore + delta)),
      description,
      reason,
    };
  }

  static getEventDefaults(): Record<ReputationEventType, { delta: number; description: string }> {
    return {
      [ReputationEventType.REVIEW_RECEIVED]: {
        delta: 0, // Вычисляется динамически
        description: 'Получен отзыв',
      },
      [ReputationEventType.DEAL_COMPLETED]: {
        delta: 2,
        description: 'Успешно завершённая сделка',
      },
      [ReputationEventType.DEAL_CANCELLED]: {
        delta: -1,
        description: 'Отменённая сделка',
      },
      [ReputationEventType.DISPUTE_OPENED]: {
        delta: -2,
        description: 'Открыт спор',
      },
      [ReputationEventType.DISPUTE_WON]: {
        delta: 5,
        description: 'Спор выигран',
      },
      [ReputationEventType.DISPUTE_LOST]: {
        delta: -5,
        description: 'Спор проигран',
      },
      [ReputationEventType.RULE_VIOLATION]: {
        delta: -10,
        description: 'Нарушение правил',
      },
      [ReputationEventType.VERIFICATION_COMPLETED]: {
        delta: 10,
        description: 'Верификация пройдена',
      },
      [ReputationEventType.BONUS]: {
        delta: 5,
        description: 'Бонус от системы',
      },
      [ReputationEventType.PENALTY]: {
        delta: -5,
        description: 'Штраф',
      },
    };
  }
}
