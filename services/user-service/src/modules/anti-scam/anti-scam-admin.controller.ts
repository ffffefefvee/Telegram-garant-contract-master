import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../admin/decorators/roles.decorator';
import { Role } from '../admin/enums/role.enum';
import { RolesGuard } from '../admin/guards/roles.guard';
import { AntiScamService } from './anti-scam.service';

/**
 * Moderation endpoints for the hybrid confirmation model (variant 1). Reuses the
 * admin module's role guard/decorator so only ADMIN/SUPER_ADMIN can moderate.
 */
@Controller('admin/anti-scam')
@UseGuards(RolesGuard)
export class AntiScamAdminController {
  constructor(private readonly antiScamService: AntiScamService) {}

  @Get('reports/pending')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async pendingReports(@Query('limit') limit?: number) {
    return this.antiScamService.listPendingReports(limit ? Number(limit) : undefined);
  }

  @Get('records/reported')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async reportedRecords(@Query('limit') limit?: number) {
    return this.antiScamService.listReportedRecords(limit ? Number(limit) : undefined);
  }

  @Post('records/:id/confirm')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('id') id: string, @Req() req: { user?: { id: string } }) {
    return this.antiScamService.confirmScammer(id, req.user?.id ?? 'system');
  }

  @Post('records/:id/reject')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async reject(@Param('id') id: string, @Req() req: { user?: { id: string } }) {
    return this.antiScamService.rejectScammer(id, req.user?.id ?? 'system');
  }

  @Post('reports/:id/reject')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async rejectReport(@Param('id') id: string, @Req() req: { user?: { id: string } }) {
    return this.antiScamService.rejectReport(id, req.user?.id ?? 'system');
  }
}
