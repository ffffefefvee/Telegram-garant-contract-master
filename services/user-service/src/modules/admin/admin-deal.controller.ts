import {
  Controller,
  Get,
  Post,
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
import { DealService } from '../deal/deal.service';

@Controller('admin/deals')
@UseGuards(RolesGuard)
export class AdminDealController {
  constructor(
    private readonly dealService: DealService,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getAllDeals(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.dealService.findAllForAdmin(page, limit, { status, type });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getDeal(@Param('id') id: string) {
    return this.dealService.findById(id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async completeDeal(@Param('id') id: string, @Req() req: any) {
    await this.dealService.forceComplete(id);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'DEAL_COMPLETED',
      targetId: id,
      description: 'Принудительно завершена',
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async cancelDeal(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    await this.dealService.forceCancel(id, reason);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'DEAL_CANCELLED',
      targetId: id,
      description: `Отменена. Причина: ${reason}`,
    });
  }

  @Get(':id/messages')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getDealMessages(@Param('id') id: string) {
    return this.dealService.getDealMessages(id);
  }
}
