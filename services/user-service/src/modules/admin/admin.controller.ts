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
import { UserService } from '../user/user.service';

@Controller('admin')
@UseGuards(RolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly userService: UserService,
  ) {}

  @Get('dashboard')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getDashboard(@Req() req: any) {
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'DASHBOARD_VIEW',
      ipAddress: req.ip,
    });
    return this.adminService.getDashboardStats();
  }

  // === USERS ===

  @Get('users')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getUsers(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.userService.findAll(page, limit);
  }

  @Get('users/:id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getUser(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  @Post('users/:id/ban')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async banUser(@Param('id') id: string, @Body('reason') reason: string, @Req() req: any) {
    await this.userService.banUser(id, reason);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'USER_BAN',
      targetId: id,
      description: `Забанен. Причина: ${reason}`,
    });
  }

}
