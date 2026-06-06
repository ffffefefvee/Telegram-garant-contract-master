import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { AdminService } from './admin.service';
import { ArbitrationSettingsService } from '../arbitration/arbitration-settings.service';

@Controller('admin/settings')
@UseGuards(RolesGuard)
export class AdminSettingsController {
  constructor(
    private readonly settingsService: ArbitrationSettingsService,
    private readonly adminService: AdminService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  @Get(':key')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getSetting(@Param('key') key: string) {
    return this.settingsService.getSetting(key);
  }

  @Put(':key')
  @Roles(Role.SUPER_ADMIN)
  async updateSetting(
    @Param('key') key: string,
    @Body('value') value: string,
    @Req() req: any,
  ) {
    const oldSetting = await this.settingsService.getSetting(key);
    await this.settingsService.updateSetting(key, value, req.user?.id);
    
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'SETTING_UPDATED',
      targetId: key,
      description: `Изменено с ${JSON.stringify(oldSetting)} на ${value}`,
    });

    return { success: true };
  }

  @Post('reset-defaults')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.SUPER_ADMIN)
  async resetDefaults(@Req() req: any) {
    await this.settingsService.initializeDefaults();
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'SETTINGS_RESET',
      description: 'Сброшены настройки по умолчанию',
    });
  }
}
