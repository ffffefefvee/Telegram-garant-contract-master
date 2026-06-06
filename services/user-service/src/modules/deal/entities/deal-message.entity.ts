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

export enum MessageType {
  TEXT = 'text',
  SYSTEM = 'system',
  NOTIFICATION = 'notification',
}

@Entity('deal_messages')
@Index(['dealId'])
@Index(['senderId'])
@Index(['createdAt'])
export class DealMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Deal, (deal) => deal.messages, {
    onDelete: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'deal_id' })
  deal: Deal;

  @Column({ type: 'uuid', name: 'deal_id' })
  dealId: string;

  @ManyToOne(() => User, { eager: true, nullable: true })
  @JoinColumn({ name: 'sender_id' })
  sender: User | null;

  @Column({ type: 'uuid', name: 'sender_id', nullable: true })
  senderId: string | null;

  @Column({
    type: 'enum',
    enum: MessageType,
    default: MessageType.TEXT,
  })
  type: MessageType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'boolean', default: false })
  isEdited: boolean;

  @Column({ type: 'timestamp', nullable: true })
  editedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  readAt: Date | null;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isSystem(): boolean {
    return this.type === MessageType.SYSTEM;
  }

  get canBeEdited(): boolean {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return this.createdAt > fiveMinutesAgo && !this.isDeleted;
  }

  get displayContent(): string {
    if (this.isDeleted) {
      return 'Сообщение удалено';
    }
    return this.content;
  }

  // Методы
  markAsRead(): void {
    this.readAt = new Date();
  }

  edit(newContent: string): void {
    if (!this.canBeEdited) {
      throw new Error('Message can only be edited within 5 minutes');
    }
    this.content = newContent;
    this.isEdited = true;
    this.editedAt = new Date();
  }

  softDelete(): void {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.content = '';
  }
}
