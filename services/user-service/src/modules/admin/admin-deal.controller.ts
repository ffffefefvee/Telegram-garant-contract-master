import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { DealService } from '../deal/deal.service';

@Controller('admin/deals')
@UseGuards(RolesGuard)
export class AdminDealController {
  constructor(
    private readonly dealService: DealService,
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

  @Get(':id/messages')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getDealMessages(@Param('id') id: string) {
    return this.dealService.getDealMessages(id);
  }
}
