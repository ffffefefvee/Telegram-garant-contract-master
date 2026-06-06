import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only audit row. Inserted (never updated) for every meaningful
 * state transition or admin action. Indexed on `(aggregateType,
 * aggregateId, createdAt)` for per-entity history scrolling and on
 * `(actorId, createdAt)` for "what did this user do" queries.
 *
 * Deliberately untyped on `details` (JSONB) — callers shape it. Keep
 * payloads small and avoid PII; this table is read by support staff.
 */
@Entity({ name: 'audit_log' })
@Index(['aggregateType', 'aggregateId', 'createdAt'])
@Index(['actorId', 'createdAt'])
export class AuditLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar', length: 64 })
  aggregateType: string;

  @Column({ type: 'varchar', length: 64 })
  aggregateId: string;

  @Column({ type: 'varchar', length: 96 })
  action: string;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
