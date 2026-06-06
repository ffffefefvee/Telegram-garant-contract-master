import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseEnumPipe,
} from '@nestjs/common';
import { ArbitratorService } from './arbitrator.service';
import { ArbitrationSettingsService } from './arbitration-settings.service';
import { DisputeService } from './dispute.service';
import { ArbitratorStatus, DisputeStatus } from './entities/enums/arbitration.enum';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPayload } from '../auth/auth.middleware';

/**
 * Контроллер для админ-панели арбитража
 * Только для Super Admin
 */
@Controller('admin/arbitration')
export class AdminArbitrationController {
  constructor(
    private readonly arbitratorService: ArbitratorService,
    private readonly settingsService: ArbitrationSettingsService,
    private readonly disputeService: DisputeService,
  ) {}

  // === Arbitrator Management ===

  @Get('arbitrators')
  async getAllArbitrators(@Query('status') status?: ArbitratorStatus) {
    return this.arbitratorService.getAllArbitrators(status);
  }

  @Get('arbitrators/:userId')
  async getArbitrator(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.arbitratorService.getProfile(userId);
  }

  @Get('arbitrators/:userId/statistics')
  async getArbitratorStatistics(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.arbitratorService.getStatistics(userId);
  }

  @Post('arbitrators/:userId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async approveArbitrator(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitratorService.approveArbitrator(user.id, userId);
  }

  @Post('arbitrators/:userId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rejectArbitrator(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitratorService.rejectArbitrator(user.id, userId);
  }

  @Post('arbitrators/:userId/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async suspendArbitrator(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: { reason: string },
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitratorService.suspendArbitrator(user.id, userId, dto.reason);
  }

  @Post('arbitrators/:userId/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivateArbitrator(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitratorService.reactivateArbitrator(user.id, userId);
  }

  // === Dispute Management ===

  @Get('disputes')
  async getAllDisputes(
    @Query('status') status?: DisputeStatus,
    @Query('limit', ParseUUIDPipe) limit?: number,
  ) {
    // Реализация получения всех споров с пагинацией
    return this.disputeService.getUserDisputes(''); // Нужно доработать
  }

  @Get('disputes/:id')
  async getDispute(@Param('id', ParseUUIDPipe) id: string) {
    return this.disputeService.getDispute(id);
  }

  @Post('disputes/:id/reassign')
  async reassignArbitrator(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { arbitratorId: string },
    @CurrentUser() user: UserPayload,
  ) {
    return this.disputeService.assignArbitrator(id, dto.arbitratorId, user.id, false);
  }

  @Post('disputes/:id/close')
  @HttpCode(HttpStatus.NO_CONTENT)
  async closeDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
    @Body() dto?: { reason?: string },
  ) {
    return this.disputeService.closeDispute(id, user.id, dto?.reason);
  }

  // === Settings Management ===

  @Get('settings')
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  @Get('settings/:key')
  async getSetting(@Param('key') key: string) {
    return this.settingsService.getSetting(key);
  }

  @Put('settings/:key')
  async updateSetting(
    @Param('key') key: string,
    @Body() dto: { value: string },
    @CurrentUser() user: UserPayload,
  ) {
    return this.settingsService.updateSetting(key, dto.value, user.id);
  }

  @Post('settings/reset-defaults')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetDefaults() {
    await this.settingsService.initializeDefaults();
  }

  // === Analytics ===

  @Get('analytics/summary')
  async getAnalyticsSummary() {
    // Статистика по арбитражу
    return {
      totalArbitrators: 0,
      activeArbitrators: 0,
      totalDisputes: 0,
      openDisputes: 0,
      closedDisputes: 0,
      averageResolutionTime: 0,
    };
  }

  @Get('analytics/arbitrators-performance')
  async getArbitratorsPerformance() {
    // Производительность арбитров
    return [];
  }

  @Get('analytics/disputes-by-type')
  async getDisputesByType() {
    // Распределение споров по типам
    return {};
  }

  @Get('analytics/disputes-by-status')
  async getDisputesByStatus() {
    // Распределение споров по статусам
    return {};
  }
}
