import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { OutboxService } from '../ops/outbox.service';
import { ReconciliationService } from '../ops/reconciliation.service';
import { MonitoringService } from '../monitoring/monitoring.service';

@Controller('admin/ops')
@UseGuards(RolesGuard)
export class AdminOpsController {
  constructor(
    private readonly outbox: OutboxService,
    private readonly reconciliation: ReconciliationService,
    private readonly monitoring: MonitoringService,
  ) {}

  @Get('outbox/dead')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async listDeadOutbox(@Query('limit') limit?: string) {
    const take = Math.min(Number(limit) || 50, 200);
    return this.outbox.listDeadEvents(take);
  }

  @Get('outbox/stats')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async outboxStats() {
    return this.outbox.getStats();
  }

  @Post('reconciliation/run')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async runReconciliation() {
    return this.reconciliation.runOnce();
  }

  @Get('reconciliation/report')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async reconciliationReport() {
    return this.reconciliation.buildDailyReport();
  }

  @Get('metrics')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async opsMetrics() {
    return this.monitoring.getPrometheusStyleMetrics();
  }
}
