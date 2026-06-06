import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('admin_logs')
@Index(['adminId'])
@Index(['action'])
@Index(['createdAt'])
export class AdminLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'admin_id', nullable: true })
  adminId: string | null;

  @Column({ type: 'varchar', length: 100 })
  action: string;

  @Column({ type: 'text', nullable: true })
  targetId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
