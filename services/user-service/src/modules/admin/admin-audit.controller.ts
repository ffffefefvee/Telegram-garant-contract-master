import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { AuditLogService } from '../ops/audit-log.service';

const parseDate = (value: string | undefined, field: string): Date | undefined => {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid ${field} (expected ISO 8601 date)`);
  }
  return d;
};

/**
 * Paginated read-only audit-log viewer for admins. Combines all filters
 * with AND. Results are ordered DESC by createdAt.
 */
@Controller('admin/audit-log')
@UseGuards(RolesGuard)
export class AdminAuditController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('aggregateType') aggregateType?: string,
    @Query('aggregateId') aggregateId?: string,
    @Query('actorId') actorId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const pageNum = page ? Math.max(1, Number.parseInt(page, 10)) : 1;
    const limitNum = limit ? Math.max(1, Number.parseInt(limit, 10)) : 50;
    if (Number.isNaN(pageNum) || Number.isNaN(limitNum)) {
      throw new BadRequestException('page/limit must be integers');
    }

    return this.auditLog.findPaginated({
      page: pageNum,
      limit: limitNum,
      action,
      aggregateType,
      aggregateId,
      actorId,
      from: parseDate(from, 'from'),
      to: parseDate(to, 'to'),
    });
  }
}
