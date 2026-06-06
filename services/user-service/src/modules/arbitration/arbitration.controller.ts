import {
  BadRequestException,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
  ParseEnumPipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor as NestFileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ArbitrationService } from './arbitration.service';
import { DisputeService } from './dispute.service';
import { EvidenceService } from './evidence.service';
import { ArbitratorService } from './arbitrator.service';
import { ArbitrationSettingsService } from './arbitration-settings.service';
import {
  OpenDisputeDto,
  SubmitEvidenceDto,
  MakeDecisionDto,
  FileAppealDto,
  ReviewAppealDto,
  ArbitrationChatMessageDto,
  DealTermsDto,
  EnforceDecisionDto,
  AssignArbitratorDto,
} from './dto';
import {
  ArbitratorAvailability,
  DisputeStatus,
} from './entities/enums/arbitration.enum';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPayload } from '../auth/auth.middleware';

/**
 * Контроллер для управления арбитражем
 */
@Controller('arbitration')
export class ArbitrationController {
  constructor(
    private readonly arbitrationService: ArbitrationService,
    private readonly disputeService: DisputeService,
    private readonly evidenceService: EvidenceService,
    private readonly arbitratorService: ArbitratorService,
    private readonly settingsService: ArbitrationSettingsService,
  ) {}

  // === Deal Terms ===

  @Post('deal-terms/:dealId')
  @HttpCode(HttpStatus.CREATED)
  async createDealTerms(
    @Param('dealId', ParseUUIDPipe) dealId: string,
    @Body() dto: DealTermsDto,
    @CurrentUser() _user: UserPayload,
  ) {
    return this.arbitrationService.createOrUpdateDealTerms(dealId, dto);
  }

  @Get('deal-terms/:dealId')
  async getDealTerms(@Param('dealId', ParseUUIDPipe) dealId: string) {
    return this.arbitrationService.getDealTerms(dealId);
  }

  // === Disputes ===

  @Post('disputes')
  @HttpCode(HttpStatus.CREATED)
  async openDispute(
    @Body() dto: OpenDisputeDto,
    @Query('dealId', ParseUUIDPipe) dealId: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.disputeService.openDispute(dealId, user.id, dto);
  }

  @Get('disputes')
  async getMyDisputes(@CurrentUser() user: UserPayload) {
    return this.disputeService.getUserDisputes(user.id);
  }

  @Get('disputes/:id')
  async getDispute(@Param('id', ParseUUIDPipe) id: string) {
    return this.disputeService.getDispute(id);
  }

  @Post('disputes/:id/assign-arbitrator')
  async assignArbitrator(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignArbitratorDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.disputeService.assignArbitrator(id, dto.arbitratorId, user.id, dto.isAutoAssigned);
  }

  @Put('disputes/:id/status')
  async updateDisputeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { status: DisputeStatus },
    @CurrentUser() user: UserPayload,
  ) {
    return this.disputeService.updateStatus(id, user.id, dto);
  }

  // === Evidence ===

  @Get('disputes/:id/evidence')
  async getDisputeEvidence(@Param('id', ParseUUIDPipe) id: string) {
    return this.evidenceService.getDisputeEvidence(id);
  }

  @Post('disputes/:id/evidence')
  @HttpCode(HttpStatus.CREATED)
  async submitEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitEvidenceDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.evidenceService.submitEvidence(id, user.id, dto);
  }

  @Post('disputes/:id/evidence/upload')
  @UseInterceptors(
    NestFileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/evidence',
        filename: (req: any, file: any, cb: any) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `${uniqueSuffix}${ext}`);
        },
      }),
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  async uploadEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: any,
    @Body('description') description: string,
    @Body('type') type: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.evidenceService.uploadFileEvidence(id, user.id, file, description, type as any);
  }

  @Get('evidence/:id')
  async getEvidence(@Param('id', ParseUUIDPipe) id: string) {
    return this.evidenceService.getEvidence(id);
  }

  @Post('evidence/:id/verify')
  async verifyEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.evidenceService.verifyEvidence(id, user.id);
  }

  @Delete('evidence/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.evidenceService.deleteEvidence(id, user.id);
  }

  // === Decisions ===

  @Post('disputes/:id/decision')
  @HttpCode(HttpStatus.CREATED)
  async makeDecision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MakeDecisionDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitrationService.makeDecision(id, user.id, dto);
  }

  @Post('decisions/:id/enforce')
  async enforceDecision(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
    @Body() dto?: EnforceDecisionDto,
  ) {
    return this.arbitrationService.enforceDecision(id, user.id, dto);
  }

  @Get('decisions/:id')
  async getDecision(@Param('id', ParseUUIDPipe) id: string) {
    return this.arbitrationService.getDecision(id);
  }

  // === Appeals ===

  @Post('disputes/:id/appeal')
  @HttpCode(HttpStatus.CREATED)
  async fileAppeal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FileAppealDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitrationService.fileAppeal(id, user.id, dto);
  }

  @Post('appeals/:id/review')
  async reviewAppeal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAppealDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitrationService.reviewAppeal(id, user.id, dto);
  }

  @Post('appeals/:id/withdraw')
  async withdrawAppeal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitrationService.withdrawAppeal(id, user.id);
  }

  // === Chat ===

  @Get('disputes/:id/chat')
  async getChatMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', ParseIntPipe) limit: number = 50,
  ) {
    const dispute = await this.disputeService.getDispute(id);
    if (!dispute.chat) {
      return [];
    }
    return this.arbitrationService.getChatMessages(dispute.chat.id, limit);
  }

  @Post('disputes/:id/chat')
  @HttpCode(HttpStatus.CREATED)
  async sendChatMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArbitrationChatMessageDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitrationService.sendChatMessage(id, user.id, dto);
  }

  // === Arbitrator ===

  @Get('arbitrators')
  async getAvailableArbitrators(@Query('limit', ParseIntPipe) limit: number = 10) {
    return this.arbitratorService.getAvailableArbitrators(limit);
  }

  @Get('arbitrators/me')
  async getMyArbitratorProfile(@CurrentUser() user: UserPayload) {
    return this.arbitratorService.getProfile(user.id);
  }

  @Post('arbitrators/apply')
  async applyForArbitrator(
    @Body() dto: { specialization?: string[]; bio?: string; languages?: string[] },
    @CurrentUser() user: UserPayload,
  ) {
    return this.arbitratorService.applyForArbitrator(
      user.id,
      dto.specialization,
      dto.bio,
      dto.languages,
    );
  }

  @Get('arbitrators/me/statistics')
  async getMyStatistics(@CurrentUser() user: UserPayload) {
    return this.arbitratorService.getStatistics(user.id);
  }

  /**
   * Self-service availability toggle for arbitrators.
   * Only ACTIVE arbitrators may flip — service throws Forbidden otherwise.
   */
  @Patch('arbitrators/me/availability')
  async setMyAvailability(
    @Body() dto: { availability: ArbitratorAvailability },
    @CurrentUser() user: UserPayload,
  ) {
    if (
      dto.availability !== ArbitratorAvailability.AVAILABLE &&
      dto.availability !== ArbitratorAvailability.AWAY
    ) {
      throw new BadRequestException(
        `availability must be one of: ${Object.values(ArbitratorAvailability).join(', ')}`,
      );
    }
    return this.arbitratorService.setAvailability(user.id, dto.availability);
  }

  // === Settings (read-only for users) ===

  @Get('settings')
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  @Get('settings/:key')
  async getSetting(@Param('key') key: string) {
    return this.settingsService.getSetting(key);
  }
}
