import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from 'typeorm';

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export enum AlertType {
  DEAL_STUCK = 'deal_stuck',
  PAYMENT_FAILED = 'payment_failed',
  ESCROW_UNRESPONSIVE = 'escrow_unresponsive',
  USER_REPORT = 'user_report',
  SYSTEM_ERROR = 'system_error',
  ARBITRATION_PENDING = 'arbitration_pending',
  COMMISSION_ALERT = 'commission_alert',
}

@Entity('system_alerts')
export class SystemAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AlertType,
  })
  type: AlertType;

  @Column({
    type: 'enum',
    enum: AlertSeverity,
    default: AlertSeverity.INFO,
  })
  severity: AlertSeverity;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ nullable: true })
  dealId: string;

  @Column({ nullable: true })
  userId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isResolved: boolean;

  @Column({ nullable: true })
  resolvedBy: string;

  @Column({ nullable: true })
  resolvedAt: Date;

  @Column({ type: 'text', nullable: true })
  resolution: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('health_checks')
export class HealthCheck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  service: string;

  @Column({ type: 'boolean', default: true })
  isHealthy: boolean;

  @Column({ nullable: true })
  responseTime: number;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({ nullable: true })
  lastError: string;

  @Column({ nullable: true })
  consecutiveFailures: number;

  @Column({ nullable: true })
  lastCheckAt: Date;

  @Column({ nullable: true })
  nextCheckAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('system_metrics')
export class SystemMetrics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  metric: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  value: number;

  @Column({ nullable: true })
  unit: string;

  @Column({ nullable: true })
  service: string;

  @Column({ nullable: true })
  tags: string;

  @CreateDateColumn()
  timestamp: Date;
}

@Entity('recovery_logs')
export class RecoveryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  incidentType: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  affectedEntities: Record<string, any>;

  @Column({ nullable: true })
  dealId: string;

  @Column({ nullable: true })
  userId: string;

  @Column({
    type: 'enum',
    enum: AlertSeverity,
    default: AlertSeverity.INFO,
  })
  severity: AlertSeverity;

  @Column({ nullable: true })
  rootCause: string;

  @Column({ nullable: true })
  fixApplied: string;

  @Column({ nullable: true })
  recoveryTime: number;

  @Column({ nullable: true })
  autoRecovered: boolean;

  @Column({ nullable: true })
  recoveredBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('job_schedules')
export class JobSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  jobType: string;

  @Column({ nullable: true })
  cronExpression: string;

  @Column({ nullable: true })
  intervalMs: number;

  @Column({ nullable: true })
  lastRunAt: Date;

  @Column({ nullable: true })
  nextRunAt: Date;

  @Column({ type: 'int', default: 0 })
  runCount: number;

  @Column({ type: 'int', default: 0 })
  errorCount: number;

  @Column({ nullable: true })
  lastError: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}