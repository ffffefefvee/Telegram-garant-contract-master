import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
  Unique,
} from 'typeorm';
import { UserSession } from './user-session.entity';
import { LanguagePreference } from './language-preference.entity';

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
  PENDING_VERIFICATION = 'pending_verification',
}

export enum UserType {
  BUYER = 'buyer',
  SELLER = 'seller',
  ARBITRATOR = 'arbitrator',
  ADMIN = 'admin',
}

@Entity('users')
@Unique(['telegramId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', unique: true, nullable: true })
  @Index()
  telegramId: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telegramUsername: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telegramFirstName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telegramLastName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telegramLanguageCode: string | null;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  @Index()
  email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({
    type: 'varchar',
    array: true,
    default: [UserType.BUYER],
  })
  roles: UserType[];

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  reputationScore: number;

  @Column({ type: 'int', default: 0 })
  completedDeals: number;

  @Column({ type: 'int', default: 0 })
  cancelledDeals: number;

  @Column({ type: 'int', default: 0 })
  disputedDeals: number;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  lastLoginIp: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  banReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  bannedAt: Date | null;

  /**
   * EVM wallet address used to receive escrow payouts (sellers) or sign
   * arbitrator transactions. NULL until the user attaches a wallet via the
   * mini-app. Stored lowercase, validated as 0x-prefixed 20-byte hex.
   */
  @Column({ type: 'varchar', length: 42, nullable: true })
  @Index()
  walletAddress: string | null;

  @Column({ type: 'timestamp', nullable: true })
  walletAttachedAt: Date | null;

  @Column({ type: 'simple-json', default: '{}' })
  settings: Record<string, any>;

  @Column({ type: 'simple-json', default: '{}' })
  metadata: Record<string, any>;

  @OneToMany(() => UserSession, (session) => session.user, { cascade: true })
  sessions: UserSession[];

  @OneToMany(() => LanguagePreference, (lang) => lang.user, { cascade: true })
  languagePreferences: LanguagePreference[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Геттеры для вычисляемых полей
  get fullName(): string | null {
    if (this.telegramFirstName && this.telegramLastName) {
      return `${this.telegramFirstName} ${this.telegramLastName}`;
    }
    return this.telegramFirstName || this.telegramUsername || null;
  }

  get isVerified(): boolean {
    return this.status === UserStatus.ACTIVE && !!this.telegramId;
  }

  get hasRole(): (role: UserType) => boolean {
    return (role: UserType) => this.roles.includes(role);
  }
}
