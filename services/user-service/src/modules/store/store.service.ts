import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  Store,
  StoreBot,
  StoreSettings,
  StoreTemplate,
  StoreStatus,
  StoreCategory,
} from './entities/store.entity';
import {
  CreateStoreDto,
  UpdateStoreDto,
  CreateBotDto,
  UpdateBotDto,
  BotSetupDto,
  StoreSettingsDto,
  CreateTemplateDto,
  UpdateTemplateDto,
  DuplicateStoreDto,
} from './dto/store.dto';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    @InjectRepository(Store)
    private storeRepository: Repository<Store>,
    @InjectRepository(StoreBot)
    private botRepository: Repository<StoreBot>,
    @InjectRepository(StoreSettings)
    private settingsRepository: Repository<StoreSettings>,
    @InjectRepository(StoreTemplate)
    private templateRepository: Repository<StoreTemplate>,
    private userService: UserService,
    @Inject(forwardRef(() => TelegramBotService))
    private telegramBotService: TelegramBotService,
    private config: ConfigService,
  ) {}

  async createStore(ownerId: string, dto: CreateStoreDto): Promise<Store> {
    const user = await this.userService.findById(ownerId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let slug = dto.slug || this.generateSlug(dto.name);
    slug = await this.ensureUniqueSlug(slug);

    const store = this.storeRepository.create({
      ownerId,
      name: dto.name,
      slug,
      description: dto.description,
      category: dto.category || StoreCategory.GENERAL,
      isPublic: dto.isPublic ?? false,
      logo: dto.logo,
      banner: dto.banner,
      status: StoreStatus.DRAFT,
      templateId: dto.templateId || 0,
    });

    const savedStore = await this.storeRepository.save(store);

    await this.settingsRepository.save({
      storeId: savedStore.id,
      welcomeMessage: {
        title: `Welcome to ${savedStore.name}!`,
        text: 'Start your secure deals here.',
        buttonText: 'Browse Products',
      },
      categories: [],
      paymentMethods: [],
      commission: { buyerFee: 0, sellerFee: 2 },
      appearance: {},
      autoResponse: { enabled: false },
      integrations: {},
      requireVerification: true,
      minDealAmount: 0,
      maxDealAmount: 0,
    });

    this.logger.log(`Store created: ${savedStore.id} by user ${ownerId}`);
    return savedStore;
  }

  async findAllStores(
    filters?: {
      status?: StoreStatus;
      category?: StoreCategory;
      ownerId?: string;
      isPublic?: boolean;
      search?: string;
    },
    pagination?: { page: number; limit: number },
  ): Promise<{ stores: Store[]; total: number }> {
    const query = this.storeRepository.createQueryBuilder('store');

    if (filters?.status) {
      query.andWhere('store.status = :status', { status: filters.status });
    }
    if (filters?.category) {
      query.andWhere('store.category = :category', { category: filters.category });
    }
    if (filters?.ownerId) {
      query.andWhere('store.ownerId = :ownerId', { ownerId: filters.ownerId });
    }
    if (filters?.isPublic !== undefined) {
      query.andWhere('store.isPublic = :isPublic', { isPublic: filters.isPublic });
    }
    if (filters?.search) {
      query.andWhere(
        '(store.name ILIKE :search OR store.description ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    query.andWhere('store.status != :deleted', { deleted: StoreStatus.DELETED });
    query.orderBy('store.createdAt', 'DESC');

    const page = pagination?.page || 1;
    const limit = pagination?.limit || 20;
    query.skip((page - 1) * limit).take(limit);

    const [stores, total] = await query.getManyAndCount();
    return { stores, total };
  }

  async findStoreById(id: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { id },
      relations: ['owner'],
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }

  async findStoreBySlug(slug: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { slug, status: StoreStatus.ACTIVE, isPublic: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }

  async updateStore(
    storeId: string,
    userId: string,
    dto: UpdateStoreDto,
  ): Promise<Store> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    if (dto.slug && dto.slug !== store.slug) {
      dto.slug = await this.ensureUniqueSlug(dto.slug);
    }

    Object.assign(store, dto);
    return this.storeRepository.save(store);
  }

  async deleteStore(storeId: string, userId: string): Promise<void> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    store.status = StoreStatus.DELETED;
    await this.storeRepository.save(store);
  }

  async getUserStores(userId: string): Promise<Store[]> {
    return this.storeRepository.find({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async createBot(dto: CreateBotDto): Promise<StoreBot> {
    await this.findStoreById(dto.storeId);

    const existing = await this.botRepository.findOne({
      where: { storeId: dto.storeId },
    });
    if (existing) {
      throw new BadRequestException('Bot already exists for this store');
    }

    const bot = this.botRepository.create({
      storeId: dto.storeId,
      telegramBotToken: dto.telegramBotToken,
      isConfigured: false,
    });

    return this.botRepository.save(bot);
  }

  async setupBot(storeId: string, userId: string, dto: BotSetupDto): Promise<StoreBot> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    let bot = await this.botRepository.findOne({ where: { storeId } });

    if (!bot) {
      bot = this.botRepository.create({ storeId });
    }

    if (dto.telegramBotToken) {
      try {
        bot.telegramBotToken = dto.telegramBotToken;
        bot.isConfigured = true;
        const tokenParts = dto.telegramBotToken.split(':');
        if (tokenParts.length === 2) {
          bot.telegramBotUsername = `bot${tokenParts[1].substring(0, 8)}`;
        }
        const appUrl = this.config.get('APP_URL', 'https://example.com');
        bot.webhookUrl = `${appUrl.replace(/\/$/, '')}/api/webhook/cryptomus`;
        bot.isWebhookActive = true;
        this.logger.log(`Store bot webhook registered for store ${storeId}`);
      } catch (error) {
        throw new BadRequestException('Invalid bot token');
      }
    }

    return this.botRepository.save(bot);
  }

  async getBotByStoreId(storeId: string): Promise<StoreBot | null> {
    return this.botRepository.findOne({ where: { storeId } });
  }

  async updateBot(storeId: string, userId: string, dto: UpdateBotDto): Promise<StoreBot> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    const bot = await this.botRepository.findOne({ where: { storeId } });
    if (!bot) {
      throw new NotFoundException('Bot not found');
    }

    Object.assign(bot, dto);
    return this.botRepository.save(bot);
  }

  async deleteBot(storeId: string, userId: string): Promise<void> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    await this.botRepository.delete({ storeId });
  }

  async getStoreSettings(storeId: string): Promise<StoreSettings> {
    let settings = await this.settingsRepository.findOne({ where: { storeId } });

    if (!settings) {
      settings = await this.settingsRepository.save({
        storeId,
        welcomeMessage: {},
        categories: [],
        paymentMethods: [],
        commission: {},
        appearance: {},
        autoResponse: { enabled: false },
        integrations: {},
        requireVerification: true,
        minDealAmount: 0,
        maxDealAmount: 0,
      });
    }

    return settings;
  }

  async updateStoreSettings(
    storeId: string,
    userId: string,
    dto: StoreSettingsDto,
  ): Promise<StoreSettings> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    const settings = await this.getStoreSettings(storeId);

    if (dto.welcomeMessage) settings.welcomeMessage = dto.welcomeMessage;
    if (dto.categories) settings.categories = dto.categories;
    if (dto.paymentMethods) settings.paymentMethods = dto.paymentMethods;
    if (dto.commission) settings.commission = dto.commission;
    if (dto.appearance) settings.appearance = dto.appearance;
    if (dto.autoResponse) settings.autoResponse = dto.autoResponse;
    if (dto.requireVerification !== undefined) settings.requireVerification = dto.requireVerification;
    if (dto.minDealAmount !== undefined) settings.minDealAmount = dto.minDealAmount;
    if (dto.maxDealAmount !== undefined) settings.maxDealAmount = dto.maxDealAmount;

    return this.settingsRepository.save(settings);
  }

  async activateStore(storeId: string, userId: string): Promise<Store> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    store.status = StoreStatus.ACTIVE;
    return this.storeRepository.save(store);
  }

  async suspendStore(storeId: string, userId: string): Promise<Store> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    store.status = StoreStatus.SUSPENDED;
    return this.storeRepository.save(store);
  }

  async duplicateStore(userId: string, dto: DuplicateStoreDto): Promise<Store> {
    const sourceStore = await this.findStoreById(dto.sourceStoreId);

    if (sourceStore.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    const newSlug = await this.ensureUniqueSlug(dto.newSlug || this.generateSlug(sourceStore.name));

    const newStore = this.storeRepository.create({
      ownerId: userId,
      name: dto.newName || `${sourceStore.name} (Copy)`,
      slug: newSlug,
      description: sourceStore.description,
      category: sourceStore.category,
      logo: sourceStore.logo,
      banner: sourceStore.banner,
      status: StoreStatus.DRAFT,
    });

    const savedStore = await this.storeRepository.save(newStore);

    const sourceSettings = await this.getStoreSettings(sourceStore.id);
    await this.settingsRepository.save({
      storeId: savedStore.id,
      welcomeMessage: sourceSettings.welcomeMessage,
      categories: sourceSettings.categories,
      paymentMethods: sourceSettings.paymentMethods,
      commission: sourceSettings.commission,
      appearance: sourceSettings.appearance,
      autoResponse: sourceSettings.autoResponse,
      integrations: {},
      requireVerification: sourceSettings.requireVerification,
      minDealAmount: sourceSettings.minDealAmount,
      maxDealAmount: sourceSettings.maxDealAmount,
    });

    return savedStore;
  }

  async getTemplates(): Promise<StoreTemplate[]> {
    return this.templateRepository.find({
      where: { isActive: true },
      order: { usageCount: 'DESC' },
    });
  }

  async getTemplateById(id: string): Promise<StoreTemplate> {
    const template = await this.templateRepository.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    return template;
  }

  async createTemplate(dto: CreateTemplateDto): Promise<StoreTemplate> {
    const template = this.templateRepository.create({
      ...dto,
      isBuiltIn: false,
      usageCount: 0,
      isActive: true,
    });
    return this.templateRepository.save(template);
  }

  async applyTemplate(storeId: string, userId: string, templateId: string): Promise<StoreSettings> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    const template = await this.getTemplateById(templateId);

    await this.templateRepository.increment({ id: templateId }, 'usageCount', 1);

    const settings = await this.getStoreSettings(storeId);

    if (template.config) {
      if (template.config.categories) settings.categories = template.config.categories;
      if (template.config.paymentMethods) settings.paymentMethods = template.config.paymentMethods;
      if (template.config.appearance) settings.appearance = template.config.appearance;
      if (template.config.welcomeMessage) settings.welcomeMessage = template.config.welcomeMessage;
    }

    store.templateId = Number(templateId);
    await this.storeRepository.save(store);

    return this.settingsRepository.save(settings);
  }

  async getStoreAnalytics(storeId: string, userId: string): Promise<Record<string, any>> {
    const store = await this.findStoreById(storeId);

    if (store.ownerId !== userId) {
      throw new ForbiddenException('Not your store');
    }

    return store.analytics || {
      totalDeals: store.totalDeals,
      totalVolume: store.totalVolume,
      totalUsers: store.totalUsers,
      rating: store.rating,
      reviewCount: store.reviewCount,
      periodStats: [],
    };
  }

  async updateStoreAnalytics(storeId: string, analytics: Record<string, any>): Promise<void> {
    const store = await this.findStoreById(storeId);
    store.analytics = analytics;
    await this.storeRepository.save(store);
  }

  async incrementStoreStats(storeId: string, dealAmount: number): Promise<void> {
    await this.storeRepository.increment({ id: storeId }, 'totalDeals', 1);
    await this.storeRepository.increment({ id: storeId }, 'totalVolume', dealAmount);
  }

  async searchStores(query: string, limit = 10): Promise<Store[]> {
    return this.storeRepository
      .createQueryBuilder('store')
      .where('store.status = :status', { status: StoreStatus.ACTIVE })
      .andWhere('store.isPublic = :isPublic', { isPublic: true })
      .andWhere('(store.name ILIKE :query OR store.description ILIKE :query)', {
        query: `%${query}%`,
      })
      .take(limit)
      .getMany();
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }

  private async ensureUniqueSlug(slug: string): Promise<string> {
    let uniqueSlug = slug;
    let counter = 1;

    while (await this.storeRepository.findOne({ where: { slug: uniqueSlug } })) {
      uniqueSlug = `${slug}-${counter}`;
      counter++;
    }

    return uniqueSlug;
  }
}