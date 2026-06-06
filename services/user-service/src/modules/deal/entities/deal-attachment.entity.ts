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
import { AttachmentType } from '../enums/deal.enum';

@Entity('deal_attachments')
@Index(['dealId'])
@Index(['uploadedById'])
@Index(['type'])
export class DealAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Deal, (deal) => deal.attachments, {
    onDelete: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal;

  @Column({ type: 'uuid', name: 'deal_id' })
  dealId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy: User;

  @Column({ type: 'uuid', name: 'uploaded_by_id' })
  uploadedById: string;

  @Column({
    type: 'enum',
    enum: AttachmentType,
  })
  type: AttachmentType;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ type: 'bigint', default: 0 })
  size: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: false })
  isImage: boolean;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'int', nullable: true })
  duration: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isDownloadable(): boolean {
    return !this.isDeleted;
  }

  get displaySize(): string {
    const kb = this.size / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  // Методы
  softDelete(): void {
    this.isDeleted = true;
    this.deletedAt = new Date();
  }
}
