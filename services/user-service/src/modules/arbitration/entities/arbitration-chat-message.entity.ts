import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { ArbitrationChat } from './arbitration-chat.entity';
import { User } from '../../user/entities/user.entity';

@Entity('arbitration_chat_messages')
@Index(['chatId'])
@Index(['senderId'])
@Index(['createdAt'])
export class ArbitrationChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ArbitrationChat, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: ArbitrationChat;

  @Column({ type: 'uuid', name: 'chat_id' })
  chatId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ type: 'uuid', name: 'sender_id' })
  senderId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  attachments: string | null; // JSON array of file URLs

  @Column({ type: 'boolean', default: false })
  isEdited: boolean;

  @Column({ type: 'timestamp', nullable: true })
  editedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get canBeEdited(): boolean {
    if (this.isDeleted) return false;
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() - this.createdAt.getTime() < fiveMinutes;
  }

  get canBeDeleted(): boolean {
    return !this.isDeleted;
  }

  // Методы
  edit(content: string): void {
    if (!this.canBeEdited) {
      throw new Error('Message can only be edited within 5 minutes');
    }
    this.content = content;
    this.isEdited = true;
    this.editedAt = new Date();
  }

  softDelete(): void {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.content = '[Message deleted]';
    this.attachments = null;
  }
}
