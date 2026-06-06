import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  OneToMany,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { ArbitratorAvailability, ArbitratorStatus } from './enums/arbitration.enum';
import { Dispute } from './dispute.entity';

/**
 * Профиль арбитра
 * Содержит статистику, специализацию и рейтинг
 */
@Entity('arbitrator_profiles')
@Index(['userId'])
@Index(['status'])
@Index(['rating'])
export class ArbitratorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId: string;

  @Column({
    type: 'enum',
    enum: ArbitratorStatus,
    default: ArbitratorStatus.PENDING,
  })
  status: ArbitratorStatus;

  /**
   * Self-managed work-state — orthogonal to {@link status}. ACTIVE
   * arbitrators can flip themselves to AWAY to skip auto-assignment
   * without admin intervention.
   */
  @Column({
    type: 'enum',
    enum: ArbitratorAvailability,
    default: ArbitratorAvailability.AVAILABLE,
  })
  availability: ArbitratorAvailability;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  rating: number; // Средний рейтинг от сторон (0-5)

  @Column({ type: 'int', default: 0 })
  totalCases: number; // Всего дел

  @Column({ type: 'int', default: 0 })
  completedCases: number; // Завершённые дела

  @Column({ type: 'int', default: 0 })
  appealedCases: number; // Дела с апелляцией

  @Column({ type: 'int', default: 0 })
  overturnedCases: number; // Дела где решение отменено

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalEarned: number; // Всего заработано на арбитраже

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  depositAmount: number; // Залог арбитра

  @Column({ type: 'text', nullable: true })
  specialization: string | null; // JSON array специализаций
  // ["digital_goods", "services", "physical_goods"]

  @Column({ type: 'text', nullable: true })
  bio: string | null; // О себе

  @Column({ type: 'text', nullable: true })
  languages: string | null; // JSON array языков
  // ["ru", "en", "es"]

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'approved_by_id' })
  approvedBy: User | null;

  @Column({ type: 'uuid', name: 'approved_by_id', nullable: true })
  approvedById: string | null;

  @Column({ type: 'timestamp', nullable: true })
  suspendedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  suspensionReason: string | null;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'suspended_by_id' })
  suspendedBy: User | null;

  @Column({ type: 'uuid', name: 'suspended_by_id', nullable: true })
  suspendedById: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Relations
  @OneToMany(() => Dispute, (dispute) => dispute.arbitrator)
  assignedDisputes: Dispute[];

  // Геттеры
  get isActive(): boolean {
    return this.status === ArbitratorStatus.ACTIVE;
  }

  get isPending(): boolean {
    return this.status === ArbitratorStatus.PENDING;
  }

  get isSuspended(): boolean {
    return this.status === ArbitratorStatus.SUSPENDED;
  }

  get isRejected(): boolean {
    return this.status === ArbitratorStatus.REJECTED;
  }

  get successRate(): number {
    if (this.completedCases === 0) return 0;
    return Math.round((this.completedCases / this.totalCases) * 100);
  }

  get overturnRate(): number {
    if (this.completedCases === 0) return 0;
    return Math.round((this.overturnedCases / this.completedCases) * 100);
  }

  get averageDecisionTime(): number {
    // Вычисляется динамически из metadata
    return this.metadata.averageDecisionTime || 0;
  }

  get specializationList(): string[] {
    if (!this.specialization) return [];
    try {
      return JSON.parse(this.specialization);
    } catch {
      return [];
    }
  }

  get languageList(): string[] {
    if (!this.languages) return [];
    try {
      return JSON.parse(this.languages);
    } catch {
      return [];
    }
  }

  get isAvailable(): boolean {
    return this.availability === ArbitratorAvailability.AVAILABLE;
  }

  get canAcceptCases(): boolean {
    return this.isActive && !this.isSuspended && this.isAvailable;
  }

  // Методы
  activate(): void {
    this.status = ArbitratorStatus.ACTIVE;
    this.approvedAt = new Date();
  }

  suspend(reason: string, userId: string): void {
    this.status = ArbitratorStatus.SUSPENDED;
    this.suspensionReason = reason;
    this.suspendedAt = new Date();
    this.suspendedById = userId;
  }

  reactivate(): void {
    this.status = ArbitratorStatus.ACTIVE;
    this.suspensionReason = null;
    this.suspendedAt = null;
    this.suspendedById = null;
  }

  reject(): void {
    this.status = ArbitratorStatus.REJECTED;
  }

  addCase(earned: number = 0): void {
    this.totalCases += 1;
    if (earned > 0) {
      this.totalEarned += earned;
    }
    this.lastActiveAt = new Date();
  }

  completeCase(): void {
    this.completedCases += 1;
    this.lastActiveAt = new Date();
  }

  addAppeal(): void {
    this.appealedCases += 1;
  }

  addOverturn(): void {
    this.overturnedCases += 1;
  }

  updateRating(newRating: number): void {
    // Скользящее среднее
    if (this.totalCases <= 1) {
      this.rating = newRating;
    } else {
      this.rating = Math.round(((this.rating * (this.totalCases - 1)) + newRating) / this.totalCases * 100) / 100;
    }
  }

  setDeposit(amount: number): void {
    this.depositAmount = amount;
  }

  // Статические методы
  static calculateRequiredDeposit(baseAmount: number = 100): number {
    return baseAmount;
  }

  static validateSpecialization(specializations: string[]): boolean {
    const validSpecializations = [
      'digital_goods',
      'physical_goods',
      'services',
      'rent',
      'crypto',
      'gaming',
      'accounts',
      'software',
    ];
    return specializations.every(s => validSpecializations.includes(s));
  }
}
