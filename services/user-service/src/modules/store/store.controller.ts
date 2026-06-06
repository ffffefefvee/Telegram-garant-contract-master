import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPayload } from '../auth/auth.middleware';
import { StoreService } from './store.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  CreateBotDto,
  BotSetupDto,
  UpdateBotDto,
  StoreSettingsDto,
  CreateTemplateDto,
  UpdateTemplateDto,
  DuplicateStoreDto,
} from './dto/store.dto';
import { StoreStatus, StoreCategory } from './entities/store.entity';

@Controller('stores')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Post()
  async createStore(@CurrentUser() user: UserPayload, @Body() dto: CreateStoreDto) {
    return this.storeService.createStore(user.id, dto);
  }

  @Get()
  async findAll(
    @Query('status') status?: StoreStatus,
    @Query('category') category?: StoreCategory,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.storeService.findAllStores(
      { status, category, search, isPublic: true },
      {
        page: page ? parseInt(page) : 1,
        limit: limit ? parseInt(limit) : 20,
      },
    );
  }

  @Get('my')
  async getMyStores(@CurrentUser() user: UserPayload) {
    return this.storeService.getUserStores(user.id);
  }

  @Get('search')
  async search(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.storeService.searchStores(query, limit ? parseInt(limit) : 10);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.storeService.findStoreById(id);
  }

  @Get('slug/:slug')
  async findBySlug(@Param('slug') slug: string) {
    return this.storeService.findStoreBySlug(slug);
  }

  @Put(':id')
  async updateStore(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.storeService.updateStore(id, user.id, dto);
  }

  @Delete(':id')
  async deleteStore(@Param('id') id: string, @CurrentUser() user: UserPayload) {
    await this.storeService.deleteStore(id, user.id);
    return { success: true };
  }

  @Post(':id/activate')
  async activateStore(@Param('id') id: string, @CurrentUser() user: UserPayload) {
    return this.storeService.activateStore(id, user.id);
  }

  @Post(':id/suspend')
  async suspendStore(@Param('id') id: string, @CurrentUser() user: UserPayload) {
    return this.storeService.suspendStore(id, user.id);
  }

  @Post(':id/duplicate')
  async duplicateStore(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @Body() dto: DuplicateStoreDto,
  ) {
    return this.storeService.duplicateStore(user.id, { ...dto, sourceStoreId: id });
  }

  @Get(':id/settings')
  async getSettings(@Param('id') id: string) {
    return this.storeService.getStoreSettings(id);
  }

  @Put(':id/settings')
  async updateSettings(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @Body() dto: StoreSettingsDto,
  ) {
    return this.storeService.updateStoreSettings(id, user.id, dto);
  }

  @Get(':id/analytics')
  async getAnalytics(@Param('id') id: string, @CurrentUser() user: UserPayload) {
    return this.storeService.getStoreAnalytics(id, user.id);
  }

  @Post(':id/bot')
  async createBot(@Param('id') id: string, @Body() dto: Omit<CreateBotDto, 'storeId'>) {
    return this.storeService.createBot({ storeId: id, ...dto });
  }

  @Get(':id/bot')
  async getBot(@Param('id') id: string) {
    return this.storeService.getBotByStoreId(id);
  }

  @Post(':id/bot/setup')
  async setupBot(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @Body() dto: BotSetupDto,
  ) {
    return this.storeService.setupBot(id, user.id, dto);
  }

  @Put(':id/bot')
  async updateBot(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateBotDto,
  ) {
    return this.storeService.updateBot(id, user.id, dto);
  }

  @Delete(':id/bot')
  async deleteBot(@Param('id') id: string, @CurrentUser() user: UserPayload) {
    await this.storeService.deleteBot(id, user.id);
    return { success: true };
  }

  @Get('templates')
  async getTemplates() {
    return this.storeService.getTemplates();
  }

  @Post('templates')
  async createTemplate(@Body() dto: CreateTemplateDto) {
    return this.storeService.createTemplate(dto);
  }

  @Get('templates/:id')
  async getTemplate(@Param('id') id: string) {
    return this.storeService.getTemplateById(id);
  }

  @Post(':id/apply-template/:templateId')
  async applyTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.storeService.applyTemplate(id, user.id, templateId);
  }
}