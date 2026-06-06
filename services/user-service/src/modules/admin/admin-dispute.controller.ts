import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { AdminService } from './admin.service';
import { DisputeService } from '../arbitration/dispute.service';
import { ArbitratorService } from '../arbitration/arbitrator.service';

@Controller('admin/disputes')
@UseGuards(RolesGuard)
export class AdminDisputeController {
  constructor(
    private readonly disputeService: DisputeService,
    private readonly arbitratorService: ArbitratorService,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getAllDisputes(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.disputeService.findAllForAdmin(page, limit, { status, type });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getDispute(@Param('id') id: string) {
    return this.disputeService.findByIdAdmin(id);
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async reassignArbitrator(
    @Param('id') id: string,
    @Body('arbitratorId') arbitratorId: string,
    @Req() req: any,
  ) {
    await this.disputeService.reassignArbitratorAdmin(id, arbitratorId);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'DISPUTE_REASSIGN',
      targetId: id,
      description: `Арбитр изменен на ${arbitratorId}`,
    });
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async closeDispute(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    await this.disputeService.forceCloseAdmin(id, reason);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'DISPUTE_CLOSED',
      targetId: id,
      description: `Закрыт. Причина: ${reason}`,
    });
  }

  @Get('stats')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getDisputeStats() {
    return this.disputeService.getAdminStats();
  }

  @Get('arbitrators/performance')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getArbitratorsPerformance() {
    return this.arbitratorService.getAllPerformance();
  }
}
