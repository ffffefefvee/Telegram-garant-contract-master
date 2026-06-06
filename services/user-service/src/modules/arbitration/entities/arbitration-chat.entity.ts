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

  @Column({ type: 'text', nullable: true })
  lastMessage: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt: Date | null;

  @Column({ type: 'int', default: 0 })
  buyerUnreadCount: number;

  @Column({ type: 'int', default: 0 })
  sellerUnreadCount: number;

  @Column({ type: 'int', default: 0 })
  arbitratorUnreadCount: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
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
