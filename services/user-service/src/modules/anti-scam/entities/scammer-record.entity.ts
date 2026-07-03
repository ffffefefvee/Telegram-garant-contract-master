import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
  Unique,
} from 'typeorm';
import { ScammerStatus, ScamConfirmationSource } from '../enums/anti-scam.enum';
import { ScamReport } from './scam-report.entity';

/**
 * A single accused Telegram account. Keyed by the target's Telegram ID, which is
 * the only stable identifier (usernames change). Aggregates all complaints and
 * tracks publication state across the two public channels.
 */
@Entity('scammer_records')
@Unique(['targetTelegramId'])
export class ScammerRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Telegram numeric ID of the accused account. Stable across username changes. */
  @Column({ type: 'bigint' })
  @Index()
  targetTelegramId: number;

  /** Last known @username (without @), may change over time. Nullable. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  targetUsername: string | null;

  /** Last known display name, best-effort for the DB-channel entry. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  targetDisplayName: string | null;

  @Column({
    type: 'enum',
    enum: ScammerStatus,
    default: ScammerStatus.REPORTED,
  })
  @Index()
  status: ScammerStatus;

  /**
   * Count of distinct reporters with an active (non-rejected) complaint.
   * Drives the auto-confirm threshold (D: hybrid model, variant 2).
   */
  @Column({ type: 'int', default: 0 })
  distinctReporterCount: number;

  @Column({
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  confirmationSource: ScamConfirmationSource | null;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt: Date | null;

  /** User id (uuid) of the moderator who confirmed/rejected, when manual. */
  @Column({ type: 'uuid', nullable: true })
  moderatedById: string | null;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  /** Message id of this scammer's entry in the public scam DB channel. */
  @Column({ type: 'bigint', nullable: true })
  dbChannelMessageId: number | null;

  /** Message id of this scammer's evidence post in the evidence channel. */
  @Column({ type: 'bigint', nullable: true })
  evidenceChannelMessageId: number | null;

  @OneToMany(() => ScamReport, (report) => report.scammerRecord, {
    cascade: true,
  })
  reports: ScamReport[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
