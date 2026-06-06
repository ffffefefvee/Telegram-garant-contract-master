import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Deal } from '../../deal/entities/deal.entity';
import { ReviewType, ReviewStatus } from '../enums/review.enum';

@Entity('reviews')
@Index(['authorId'])
@Index(['targetId'])
@Index(['dealId'])
@Index(['rating'])
@Index(['createdAt'])
@Unique(['dealId', 'authorId'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ type: 'uuid', name: 'author_id' })
  authorId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'target_id' })
  target: User;

  @Column({ type: 'uuid', name: 'target_id' })
  targetId: string;

  @ManyToOne(() => Deal, { eager: false, nullable: true })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal | null;

  @Column({ type: 'uuid', name: 'deal_id', nullable: true })
  dealId: string | null;

  @Column({
    type: 'enum',
    enum: ReviewType,
  })
  type: ReviewType;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({
    type: 'enum',
    enum: ReviewStatus,
    default: ReviewStatus.PUBLISHED,
  })
  status: ReviewStatus;

  @Column({ type: 'boolean', default: false })
  isAnonymous: boolean;

  @Column({ type: 'jsonb', default: {} })
  ratings: Record<string, number>; // { communication: 5, quality: 4, speed: 5 }

  @Column({ type: 'int', default: 0 })
  helpfulCount: number;

  @Column({ type: 'int', default: 0 })
  notHelpfulCount: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  hiddenAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  hideReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  hiddenBy: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isPublished(): boolean {
    return this.status === ReviewStatus.PUBLISHED;
  }

  get isHidden(): boolean {
    return this.status === ReviewStatus.HIDDEN;
  }

  get averageRating(): number {
    const ratings = Object.values(this.ratings);
    if (ratings.length === 0) return this.rating;
    
    const sum = ratings.reduce((a, b) => a + b, 0);
    return Math.round((sum / ratings.length) * 10) / 10;
  }

  get helpfulnessRatio(): number {
    const total = this.helpfulCount + this.notHelpfulCount;
    if (total === 0) return 1;
    return this.helpfulCount / total;
  }

  // Методы
  publish(): void {
    this.status = ReviewStatus.PUBLISHED;
    this.publishedAt = new Date();
  }

  hide(reason: string, hiddenBy: string): void {
    this.status = ReviewStatus.HIDDEN;
    this.hiddenAt = new Date();
    this.hideReason = reason;
    this.hiddenBy = hiddenBy;
  }

  delete(): void {
    this.status = ReviewStatus.DELETED;
    this.comment = null;
  }

  markHelpful(isHelpful: boolean): void {
    if (isHelpful) {
      this.helpfulCount += 1;
    } else {
      this.notHelpfulCount += 1;
    }
  }

  // Статические методы
  static calculateReputationDelta(rating: number, ratings?: Record<string, number>): number {
    let delta = 0;

    // Базовый дельта от рейтинга
    switch (rating) {
      case 5:
        delta = 5;
        break;
      case 4:
        delta = 2;
        break;
      case 3:
        delta = 0;
        break;
      case 2:
        delta = -3;
        break;
      case 1:
        delta = -5;
        break;
    }

    // Бонус за детальные оценки
    if (ratings) {
      const values = Object.values(ratings);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (avg >= 4.5) {
        delta += 1;
      } else if (avg <= 2) {
        delta -= 1;
      }
    }

    return delta;
  }

  static getRatingLabel(rating: number): string {
    switch (rating) {
      case 5:
        return 'Отлично';
      case 4:
        return 'Хорошо';
      case 3:
        return 'Нормально';
      case 2:
        return 'Плохо';
      case 1:
        return 'Ужасно';
      default:
        return '';
    }
  }
}
