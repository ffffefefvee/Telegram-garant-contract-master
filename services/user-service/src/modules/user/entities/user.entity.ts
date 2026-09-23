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
  SUPER_ADMIN = 'super_admin',
}

@Entity('users')
@Unique(['telegramId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', name: 'telegram_id', unique: true, nullable: true })
  @Index()
  telegramId: number | null;

  @Column({ type: 'varchar', length: 255, name: 'telegram_username', nullable: true })
  telegramUsername: string | null;

  @Column({ type: 'varchar', length: 255, name: 'telegram_first_name', nullable: true })
  telegramFirstName: string | null;

  @Column({ type: 'varchar', length: 255, name: 'telegram_last_name', nullable: true })
  telegramLastName: string | null;

  @Column({ type: 'varchar', length: 255, name: 'telegram_language_code', nullable: true })
  telegramLanguageCode: string | null;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  @Index()
  email: string | null;

  @Column({ type: 'varchar', length: 255, name: 'password_hash', nullable: true })
  passwordHash: string | null;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({
    type: 'enum',
    enum: UserType,
    enumName: 'user_type_enum',
    array: true,
    default: [UserType.BUYER],
  })
  roles: UserType[];

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance: number;

  @Column({ type: 'decimal', name: 'reputation_score', precision: 5, scale: 2, default: 0 })
  reputationScore: number;

  @Column({ type: 'int', name: 'completed_deals', default: 0 })
  completedDeals: number;

  @Column({ type: 'int', name: 'cancelled_deals', default: 0 })
  cancelledDeals: number;

  @Column({ type: 'int', name: 'disputed_deals', default: 0 })
  disputedDeals: number;

  @Column({ type: 'timestamp', name: 'last_login_at', nullable: true })
  lastLoginAt: Date | null;

  @Column({ type: 'varchar', length: 45, name: 'last_login_ip', nullable: true })
  lastLoginIp: string | null;

  @Column({ type: 'varchar', length: 255, name: 'ban_reason', nullable: true })
  banReason: string | null;

  @Column({ type: 'timestamp', name: 'banned_at', nullable: true })
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

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'timestamp', name: 'deleted_at', nullable: true })
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
