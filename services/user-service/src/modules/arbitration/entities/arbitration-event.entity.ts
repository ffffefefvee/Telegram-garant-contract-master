import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Dispute } from './dispute.entity';
import { User } from '../../user/entities/user.entity';
import { ArbitrationEventType } from './enums/arbitration.enum';

@Entity('arbitration_events')
@Index(['disputeId'])
@Index(['type'])
@Index(['createdAt'])
export class ArbitrationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Dispute, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute: Dispute;

  @Column({ type: 'uuid', name: 'dispute_id' })
  disputeId: string;

  @Column({
    type: 'enum',
    enum: ArbitrationEventType,
  })
  type: ArbitrationEventType;

  @Column({ type: 'text' })
  description: string;

  @ManyToOne(() => User, { eager: false, nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'uuid', name: 'actor_id', nullable: true })
  actorId: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isSystemEvent(): boolean {
    return !this.actorId;
  }

  // Статические методы
  static createEvent(
    disputeId: string,
    type: ArbitrationEventType,
    description: string,
    actorId?: string,
    metadata?: Record<string, any>,
  ): Partial<ArbitrationEvent> {
    return {
      disputeId,
      type,
      description,
      actorId,
      metadata: metadata || {},
    };
  }
}
