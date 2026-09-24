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
} from 'typeorm';
import { Dispute } from './dispute.entity';
import { ArbitrationChatMessage } from './arbitration-chat-message.entity';

@Entity('arbitration_chats')
@Index(['disputeId'])
export class ArbitrationChat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Dispute, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute: Dispute;

  @Column({ type: 'uuid', name: 'dispute_id', unique: true })
  disputeId: string;

  @Column({ name: 'last_message', type: 'text', nullable: true })
  lastMessage: string | null;

  @Column({ name: 'last_message_at', type: 'timestamp', nullable: true })
  lastMessageAt: Date | null;

  @Column({ name: 'buyer_unread_count', type: 'int', default: 0 })
  buyerUnreadCount: number;

  @Column({ name: 'seller_unread_count', type: 'int', default: 0 })
  sellerUnreadCount: number;

  @Column({ name: 'arbitrator_unread_count', type: 'int', default: 0 })
  arbitratorUnreadCount: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => ArbitrationChatMessage, (message) => message.chat, { cascade: true })
  messages: ArbitrationChatMessage[];

  // Методы
  addMessage(message: string, isBuyer: boolean, isSeller: boolean, isArbitrator: boolean): void {
    this.lastMessage = message;
    this.lastMessageAt = new Date();
    
    if (isBuyer) {
      this.sellerUnreadCount += 1;
      this.arbitratorUnreadCount += 1;
    } else if (isSeller) {
      this.buyerUnreadCount += 1;
      this.arbitratorUnreadCount += 1;
    } else if (isArbitrator) {
      this.buyerUnreadCount += 1;
      this.sellerUnreadCount += 1;
    }
  }

  markAsRead(userRole: 'buyer' | 'seller' | 'arbitrator'): void {
    switch (userRole) {
      case 'buyer':
        this.buyerUnreadCount = 0;
        break;
      case 'seller':
        this.sellerUnreadCount = 0;
        break;
      case 'arbitrator':
        this.arbitratorUnreadCount = 0;
        break;
    }
  }

  deactivate(): void {
    this.isActive = false;
  }
}
