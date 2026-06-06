import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

export enum StoreStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export enum StoreCategory {
  GENERAL = 'general',
  DIGITAL_GOODS = 'digital_goods',
  PHYSICAL_GOODS = 'physical_goods',
  SERVICES = 'services',
  RENT = 'rent',
  GAMING = 'gaming',
  CUSTOM = 'custom',
}

@Entity('store_bots')
export class StoreBot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  storeId: string;

  @Column({ nullable: true })
  telegramBotToken: string;

  @Column({ nullable: true })
  telegramBotUsername: string;

  @Column({ nullable: true })
  telegramChatId: string;

  @Column({ type: 'boolean', default: false })
  isConfigured: boolean;

  @Column({ type: 'boolean', default: false })
  isWebhookActive: boolean;

  @Column({ nullable: true })
  webhookUrl: string;

  @Column({ type: 'int', default: 0 })
  totalDeals: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalVolume: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('store_settings')
export class StoreSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  storeId: string;

  @Column({ type: 'jsonb', nullable: true })
  welcomeMessage: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  categories: Record<string, any>[];

  @Column({ type: 'jsonb', nullable: true })
  paymentMethods: Record<string, any>[];

  @Column({ type: 'jsonb', nullable: true })
  commission: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  appearance: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  autoResponse: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  integrations: Record<string, any>;

  @Column({ type: 'boolean', default: true })
  requireVerification: boolean;

  @Column({ type: 'int', default: 0 })
  minDealAmount: number;

  @Column({ type: 'int', default: 0 })
  maxDealAmount: number;

  @Column({ type: 'jsonb', nullable: true })
  restrictions: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('store_templates')
export class StoreTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  previewImage: string;

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isBuiltIn: boolean;

  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column()
  name: string;

  @Column({ nullable: true })
  slug: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  logo: string;

  @Column({ nullable: true })
  banner: string;

  @Column({
    type: 'enum',
    enum: StoreStatus,
    default: StoreStatus.DRAFT,
  })
  status: StoreStatus;

  @Column({
    type: 'enum',
    enum: StoreCategory,
    default: StoreCategory.GENERAL,
  })
  category: StoreCategory;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isPublic: boolean;

  @Column({ nullable: true })
  domain: string;

  @Column({ nullable: true })
  customDomain: string;

  @Column({ type: 'int', default: 0 })
  templateId: number;

  @Column({ type: 'int', default: 0 })
  totalDeals: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalVolume: number;

  @Column({ type: 'int', default: 0 })
  totalUsers: number;

  @Column({ type: 'int', default: 0 })
  rating: number;

  @Column({ type: 'int', default: 0 })
  reviewCount: number;

  @Column({ type: 'jsonb', nullable: true })
  seoConfig: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  analytics: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}