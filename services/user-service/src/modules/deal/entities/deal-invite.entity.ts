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
import { Deal } from './deal.entity';
import { User } from '../../user/entities/user.entity';

export enum InviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

@Entity('deal_invites')
@Unique(['deal', 'inviteToken'])
@Index(['dealId'])
@Index(['invitedUserId'])
@Index(['status'])
@Index(['expiresAt'])
export class DealInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Deal, (deal) => deal.invites, {
    onDelete: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal;

  @Column({ type: 'uuid', name: 'deal_id' })
  dealId: string;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn({ name: 'invited_user_id' })
  invitedUser: User | null;

  @Column({ type: 'uuid', name: 'invited_user_id', nullable: true })
  invitedUserId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  invitedUserTelegramId: string | null;

  @Column({ type: 'varchar', length: 255 })
  inviteToken: string;

  @Column({ type: 'varchar', length: 500 })
  inviteUrl: string;

  @Column({
    type: 'enum',
    enum: InviteStatus,
    default: InviteStatus.PENDING,
  })
  status: InviteStatus;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  rejectedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  rejectedBy: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastViewedAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isExpired(): boolean {
    return new Date() > this.expiresAt && this.status === InviteStatus.PENDING;
  }

  get isValid(): boolean {
    return this.status === InviteStatus.PENDING && !this.isExpired;
  }

  get canBeAccepted(): boolean {
    return this.isValid;
  }

  get daysUntilExpiry(): number {
    const now = new Date();
    const diff = this.expiresAt.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  // Методы
  accept(): void {
    if (!this.canBeAccepted) {
      throw new Error('Invite cannot be accepted');
    }
    this.status = InviteStatus.ACCEPTED;
    this.acceptedAt = new Date();
  }

  reject(reason?: string): void {
    if (this.status !== InviteStatus.PENDING) {
      throw new Error('Invite cannot be rejected');
    }
    this.status = InviteStatus.REJECTED;
    this.rejectedAt = new Date();
    if (reason) {
      this.metadata = { ...this.metadata, rejectReason: reason };
    }
  }

  expire(): void {
    this.status = InviteStatus.EXPIRED;
  }

  cancel(): void {
    if (this.status !== InviteStatus.PENDING) {
      throw new Error('Only pending invites can be cancelled');
    }
    this.status = InviteStatus.CANCELLED;
  }

  incrementViewCount(): void {
    this.viewCount += 1;
    this.lastViewedAt = new Date();
  }

  // Статические методы
  static generateToken(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('hex');
  }

  static generateInviteUrl(baseUrl: string, token: string): string {
    return `${baseUrl}/deal/invite/${token}`;
  }
}
