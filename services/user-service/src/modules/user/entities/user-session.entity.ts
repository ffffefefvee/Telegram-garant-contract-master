import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum SessionType {
  TELEGRAM = 'telegram',
  WEB = 'web',
  API = 'api',
}

@Entity('user_sessions')
@Index(['userId'])
@Index(['expiresAt'])
@Index(['isActive'])
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.sessions, {
    onDelete: 'CASCADE',
    eager: true,
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 500, unique: true })
  token: string;

  @Column({
    type: 'varchar',
    length: 50,
    enum: SessionType,
    default: SessionType.TELEGRAM,
  })
  type: SessionType;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  deviceInfo: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastActivityAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  revokeReason: string | null;

  @Column({ type: 'simple-json', default: '{}' })
  metadata: Record<string, any>;

  // Методы для проверки сессии
  get isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  get isValid(): boolean {
    return this.isActive && !this.isExpired && !this.revokedAt;
  }

  updateActivity(): void {
    this.lastActivityAt = new Date();
  }

  revoke(reason?: string): void {
    this.isActive = false;
    this.revokedAt = new Date();
    this.revokeReason = reason || 'Manual revoke';
  }
}
