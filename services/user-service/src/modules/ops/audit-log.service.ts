import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  EntityManager,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditLogEntry } from './entities/audit-log.entity';

export interface AuditWriteInput {
  actorId?: string | null;
  actorRole?: string | null;
  aggregateType: string;
  aggregateId: string;
  action: string;
  details?: Record<string, unknown>;
  manager?: EntityManager;
}

/**
 * Append-only audit log. Failures to write the log MUST NOT crash the
 * underlying business operation — we log + swallow. Use a transactional
 * `manager` to ensure the audit row commits atomically with the business
 * write when the operation is sensitive (admin actions, slashing, etc.).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLogEntry)
    private readonly repo: Repository<AuditLogEntry>,
  ) {}

  async write(input: AuditWriteInput): Promise<AuditLogEntry | null> {
    try {
      const repo = input.manager
        ? input.manager.getRepository(AuditLogEntry)
        : this.repo;
      const row = repo.create({
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        action: input.action,
        details: input.details ?? {},
      });
      return await repo.save(row);
    } catch (err) {
      // Never let an audit failure cascade. Log loudly so we notice.
      this.logger.error(
        `Audit write failed for ${input.aggregateType}/${input.aggregateId} action=${input.action}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async findByAggregate(
    aggregateType: string,
    aggregateId: string,
    limit = 100,
  ): Promise<AuditLogEntry[]> {
    return this.repo.find({
      where: { aggregateType, aggregateId } as FindOptionsWhere<AuditLogEntry>,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findByActor(actorId: string, limit = 100): Promise<AuditLogEntry[]> {
    return this.repo.find({
      where: { actorId } as FindOptionsWhere<AuditLogEntry>,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Paginated query for the admin audit log viewer. All filters are
   * optional; combine them with AND. Returns the page plus total count
   * so the UI can render a pager.
   */
  async findPaginated(opts: {
    page?: number;
    limit?: number;
    action?: string;
    aggregateType?: string;
    aggregateId?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
  }): Promise<{ items: AuditLogEntry[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));

    const where: FindOptionsWhere<AuditLogEntry> = {};
    if (opts.action) where.action = opts.action;
    if (opts.aggregateType) where.aggregateType = opts.aggregateType;
    if (opts.aggregateId) where.aggregateId = opts.aggregateId;
    if (opts.actorId) where.actorId = opts.actorId;
    if (opts.from && opts.to) {
      where.createdAt = Between(opts.from, opts.to);
    } else if (opts.from) {
      where.createdAt = MoreThanOrEqual(opts.from);
    } else if (opts.to) {
      where.createdAt = LessThanOrEqual(opts.to);
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }
}
