import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { ScamReportStatus } from '../enums/anti-scam.enum';
import { ScammerRecord } from './scammer-record.entity';

/**
 * One complaint filed against a scammer record.
 *
 * Deduplication (D: variant 2 anti-spam):
 *  - (scammerRecordId, reporterUserId) is UNIQUE — a user can complain about the
 *    same target only once.
 *  - contentHash is UNIQUE — the exact same complaint text can't be re-submitted
 *    across the platform, blocking copy-paste flooding.
 *
 * Screenshots are MANDATORY (D: proofs required) — stored as Telegram file_ids so
 * the bot can re-send them to the evidence channel without external storage.
 */
@Entity('scam_reports')
@Unique('UQ_scam_report_reporter', ['scammerRecordId', 'reporterUserId'])
@Unique('UQ_scam_report_content_hash', ['contentHash'])
export class ScamReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ScammerRecord, (record) => record.reports, {
    onDelete: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'scammer_record_id' })
  scammerRecord: ScammerRecord;

  @Column({ type: 'uuid', name: 'scammer_record_id' })
  @Index()
  scammerRecordId: string;

  /** Platform user id (uuid) of the reporter. */
  @Column({ type: 'uuid', name: 'reporter_user_id' })
  @Index()
  reporterUserId: string;

  /** Telegram id of the reporter, for quick cross-checks and anti-self-report. */
  @Column({ type: 'bigint', nullable: true })
  reporterTelegramId: number | null;

  /** Free-text reason describing the scam. */
  @Column({ type: 'text' })
  reason: string;

  /**
   * SHA-256 of the normalized reason text. Enforces global uniqueness of
   * complaint bodies to stop identical copy-pasted reports.
   */
  @Column({ type: 'varchar', length: 64 })
  contentHash: string;

  /**
   * Telegram file_ids of mandatory proof screenshots (at least one). Kept as
   * file_ids so the bot re-uploads them to the evidence channel directly.
   */
  @Column({ type: 'simple-json', default: '[]' })
  screenshotFileIds: string[];

  @Column({
    type: 'enum',
    enum: ScamReportStatus,
    default: ScamReportStatus.PENDING,
  })
  @Index()
  status: ScamReportStatus;

  /** User id (uuid) of the moderator who approved/rejected this report. */
  @Column({ type: 'uuid', nullable: true })
  moderatedById: string | null;

  @Column({ type: 'timestamp', nullable: true })
  moderatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
