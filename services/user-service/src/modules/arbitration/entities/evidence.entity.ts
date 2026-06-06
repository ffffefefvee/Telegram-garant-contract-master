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
import { Dispute } from './dispute.entity';
import { EvidenceType } from './enums/arbitration.enum';

@Entity('evidence')
@Index(['disputeId'])
@Index(['submittedById'])
@Index(['type'])
@Index(['createdAt'])
export class Evidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Dispute, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute: Dispute;

  @Column({ type: 'uuid', name: 'dispute_id' })
  disputeId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy: User;

  @Column({ type: 'uuid', name: 'submitted_by_id' })
  submittedById: string;

  @Column({
    type: 'enum',
    enum: EvidenceType,
  })
  type: EvidenceType;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  content: string | null; // Для текста или ссылок

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  filePath: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  fileType: string | null; // MIME type

  @Column({ type: 'bigint', nullable: true })
  fileSize: number | null; // В байтах

  @Column({ type: 'varchar', length: 255, nullable: true })
  fileHash: string | null; // SHA256 hash для верификации

  @Column({ type: 'text', nullable: true })
  metadata: string | null; // JSON string для доп. данных

  @Column({ type: 'boolean', default: false })
  isVerified: boolean;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'verified_by_id' })
  verifiedBy: User | null;

  @Column({ type: 'uuid', name: 'verified_by_id', nullable: true })
  verifiedById: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  // Геттеры
  get isFile(): boolean {
    return [EvidenceType.SCREENSHOT, EvidenceType.VIDEO, EvidenceType.FILE, EvidenceType.AUDIO].includes(this.type);
  }

  get isTextual(): boolean {
    return [EvidenceType.TEXT, EvidenceType.LINK].includes(this.type);
  }

  get canBeDeleted(): boolean {
    // Можно удалить только свои доказательства пока спор не закрыт
    return !this.dispute.isClosed;
  }

  // Методы
  markAsVerified(userId: string): void {
    this.isVerified = true;
    this.verifiedAt = new Date();
    this.verifiedById = userId;
  }

  incrementViewCount(): void {
    this.viewCount += 1;
  }

  // Статические методы
  static validateFileSize(size: number, maxSize: number = 10 * 1024 * 1024): boolean {
    // По умолчанию макс. 10MB
    return size <= maxSize;
  }

  static validateFileType(mimeType: string, allowedTypes: string[]): boolean {
    return allowedTypes.some(type => mimeType.startsWith(type));
  }

  static generateFileHash(buffer: Buffer): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
