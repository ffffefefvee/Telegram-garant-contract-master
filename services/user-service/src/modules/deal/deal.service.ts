import { createHash } from 'crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Brackets, IsNull } from 'typeorm';
import { Deal } from './entities/deal.entity';
import { DealMessage, MessageType } from './entities/deal-message.entity';
import { DealAttachment } from './entities/deal-attachment.entity';
import { DealInvite, InviteStatus } from './entities/deal-invite.entity';
import { DealEvent } from './entities/deal-event.entity';
import {
  DealType,
  DealStatus,
  DealSide,
  DealEventType,
  AttachmentType,
  Currency,
  DealSubcategory,
  FeeModel,
} from './enums/deal.enum';
import { DealStateMachine } from './fsm/deal-state-machine';
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import { EscrowService } from '../escrow/escrow.service';
import { OutboxService } from '../ops/outbox.service';
import { ReputationService } from '../review/reputation.service';
import { KycLimitsService } from '../user/kyc-limits.service';

/** D6: minimum deal amount in RUB. */
export const DEAL_MIN_AMOUNT_RUB = 300;

export interface CreateDealDto {
  type: DealType;
  /** D3: subcategory — required for DIGITAL deals in MVP. */
  subcategory?: DealSubcategory;
  amount: number;
  currency?: Currency;
  /** D4: fee distribution model. Defaults to BUYER_PAYS. */
  feeModel?: FeeModel;
  description: string;
  title?: string;
  terms?: string;
  deadline?: Date;
  sellerId?: string;
  metadata?: Record<string, any>;
}

export interface UpdateDealDto {
  title?: string;
  description?: string;
  terms?: string;
  deadline?: Date;
  metadata?: Record<string, any>;
}

export interface CreateMessageDto {
  dealId: string;
  senderId: string;
  content: string;
  type?: MessageType;
}

export interface CreateAttachmentDto {
  dealId: string;
  uploadedById: string;
  url: string;
  filename: string;
  type: AttachmentType;
  mimeType?: string;
  size?: number;
  description?: string;
  metadata?: Record<string, any>;
}

export interface DealFilterDto {
  status?: DealStatus[];
  type?: DealType[];
  side?: DealSide;
  userId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'amount' | 'status';
  sortOrder?: 'ASC' | 'DESC';
}

@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);
  private readonly stateMachine: DealStateMachine;

  constructor(
    @InjectRepository(Deal)
    private dealRepository: Repository<Deal>,
    @InjectRepository(DealMessage)
    private messageRepository: Repository<DealMessage>,
    @InjectRepository(DealAttachment)
    private attachmentRepository: Repository<DealAttachment>,
    @InjectRepository(DealInvite)
    private inviteRepository: Repository<DealInvite>,
    @InjectRepository(DealEvent)
    private eventRepository: Repository<DealEvent>,
    private userService: UserService,
    private escrowService: EscrowService,
    private outbox: OutboxService,
    private dataSource: DataSource,
    private reputationService: ReputationService,
    private kycLimits: KycLimitsService,
    private configService: ConfigService,
  ) {
    this.stateMachine = new DealStateMachine({
      commissionRate: 0.05, // 5% комиссия
      autoConfirmDays: 7,
      disputePeriodDays: 14,
    });
  }

  /**
   * Создание новой сделки
   */
  async create(data: CreateDealDto, buyerOrId: User | string): Promise<Deal> {
    // D6: minimum amount validation
    const currency = data.currency || Currency.RUB;
    if (data.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }
    if (currency === Currency.RUB && data.amount < DEAL_MIN_AMOUNT_RUB) {
      throw new BadRequestException(
        `Minimum deal amount is ${DEAL_MIN_AMOUNT_RUB} RUB (D6)`,
      );
    }
    // D3: subcategory required for digital deals
    if (data.type === DealType.DIGITAL && !data.subcategory) {
      throw new BadRequestException(
        'subcategory is required for DIGITAL deals (D3)',
      );
    }

    const buyerIdForKyc =
      typeof buyerOrId === 'string' ? buyerOrId : buyerOrId.id;
    await this.kycLimits.assertCanCreateDeal(buyerIdForKyc, data.amount);

    // Buyer can be passed as a full User entity (legacy callers) or as
    // a string id (the controller now hands us the authenticated user
    // payload from middleware, which only has the id). Always resolve
    // to a hydrated User so we can read walletAddress, etc.
    const buyer: User =
      typeof buyerOrId === 'string'
        ? await this.userService.findById(buyerOrId)
        : buyerOrId;
    if (!buyer) {
      throw new BadRequestException('Buyer not found');
    }

    // Проверка продавца если указан
    let seller: User | null = null;
    if (data.sellerId) {
      seller = await this.userService.findById(data.sellerId);
    }

    // Генерация номера сделки
    const dealNumber = await this.generateDealNumber();

    // Расчёт комиссии
    const commissionRate = this.stateMachine['config']?.commissionRate || 0.05;
    const commissionAmount = data.amount * commissionRate;

    const deal = this.dealRepository.create({
      ...data,
      dealNumber,
      buyer,
      seller,
      currency,
      commissionRate: commissionRate * 100,
      commissionAmount,
      subcategory: data.subcategory ?? null,
      feeModel: data.feeModel ?? FeeModel.BUYER_PAYS,
      status: seller ? DealStatus.PENDING_ACCEPTANCE : DealStatus.DRAFT,
      metadata: data.metadata || {},
    });

    const savedDeal = await this.dataSource.transaction(async (manager) => {
      const row = await manager.save(deal);
      if (seller) {
        await this.outbox.enqueue({
          aggregateType: 'deal',
          aggregateId: row.id,
          eventType: 'deal.created',
          payload: {
            dealId: row.id,
            dealTitle: row.title ?? `Deal ${dealNumber}`,
            dealAmount: Number(row.amount),
            sellerUserId: seller.id,
            buyerUserId: buyer.id,
          },
          manager,
        });
      }
      return row;
    });

    await this.createEvent({
      type: DealEventType.DEAL_CREATED,
      dealId: savedDeal.id,
      userId: buyer.id,
      description: `Сделка ${dealNumber} создана`,
    });

    // Deploy on-chain escrow only when both parties have wallets attached.
    // Otherwise the deal stays in DRAFT/PENDING_ACCEPTANCE; the wallet
    // attachment endpoint will retry deployment when the missing side
    // attaches their wallet.
    if (buyer.walletAddress && seller?.walletAddress) {
      try {
        const escrowResult = await this.escrowService.createEscrow(
          savedDeal.id,
          buyer.walletAddress,
          seller.walletAddress,
          Number(savedDeal.amount),
        );
        savedDeal.escrowAddress = escrowResult.escrowAddress;
        await this.dealRepository.save(savedDeal);
        this.logger.log(
          `Escrow deployed: ${escrowResult.escrowAddress} for deal ${savedDeal.id}`,
        );
      } catch (error) {
        this.logger.error(`Escrow deployment failed for deal ${savedDeal.id}`, error);
        // Don't fail the whole deal — the user can re-trigger deployment later.
      }
    } else {
      this.logger.log(
        `Deal ${savedDeal.id} created without escrow: buyer.walletAddress=${!!buyer.walletAddress}, seller.walletAddress=${!!seller?.walletAddress}`,
      );
    }

    this.logger.log(`Deal created: ${savedDeal.id}, number: ${dealNumber}`);

    return savedDeal;
  }

  /**
   * Поиск сделки по ID
   */
  async findById(id: string, relations: string[] = []): Promise<Deal> {
    const deal = await this.dealRepository.findOne({
      where: { id },
      relations: relations.length > 0 ? relations : ['buyer', 'seller'],
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    return deal;
  }

  /**
   * Поиск сделки по номеру
   */
  async findByNumber(number: string): Promise<Deal> {
    const deal = await this.dealRepository.findOne({
      where: { dealNumber: number },
      relations: ['buyer', 'seller'],
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    return deal;
  }

  /**
   * Поиск сделки по публичному slug
   */
  async findByPublicSlug(slug: string): Promise<Deal> {
    const deal = await this.dealRepository.findOne({
      where: { publicSlug: slug, isPublic: true },
      relations: ['buyer', 'seller'],
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    return deal;
  }

  /**
   * Фильтрация сделок
   */
  async findMany(filter: DealFilterDto, userId?: string): Promise<{
    deals: Deal[];
    total: number;
  }> {
    const query = this.dealRepository.createQueryBuilder('deal');

    query.leftJoinAndSelect('deal.buyer', 'buyer');
    query.leftJoinAndSelect('deal.seller', 'seller');

    // Фильтры
    if (filter.status && filter.status.length > 0) {
      query.andWhere('deal.status IN (:...statuses)', {
        statuses: filter.status,
      });
    }

    if (filter.type && filter.type.length > 0) {
      query.andWhere('deal.type IN (:...types)', {
        types: filter.type,
      });
    }

    if (filter.userId) {
      query.andWhere(
        new Brackets((qb) => {
          qb.where('deal.buyerId = :userId', { userId }).orWhere(
            'deal.sellerId = :userId',
            { userId },
          );
        }),
      );
    }

    if (filter.search) {
      query.andWhere(
        new Brackets((qb) => {
          qb.where('deal.title ILIKE :search', { search: `%${filter.search}%` })
            .orWhere('deal.description ILIKE :search', {
              search: `%${filter.search}%`,
            })
            .orWhere('deal.dealNumber ILIKE :search', {
              search: `%${filter.search}%`,
            });
        }),
      );
    }

    // Сортировка
    const sortBy = filter.sortBy || 'createdAt';
    const sortOrder = filter.sortOrder || 'DESC';
    query.orderBy(`deal.${sortBy}`, sortOrder);

    // Пагинация
    const limit = filter.limit || 20;
    const offset = filter.offset || 0;
    query.skip(offset).take(limit);

    const [deals, total] = await query.getManyAndCount();

    return { deals, total };
  }

  /**
   * Обновление сделки
   */
  async update(id: string, data: UpdateDealDto, userId: string): Promise<Deal> {
    const deal = await this.findById(id);

    // Проверка прав
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    // Можно редактировать только черновик или ожидание принятия
    if (
      ![DealStatus.DRAFT, DealStatus.PENDING_ACCEPTANCE].includes(deal.status)
    ) {
      throw new ConflictException('Cannot edit deal in current status');
    }

    Object.assign(deal, data);
    deal.updatedAt = new Date();

    return this.dealRepository.save(deal);
  }

  /**
   * Отмена сделки
   */
  async cancel(id: string, userId: string, reason?: string): Promise<Deal> {
    const deal = await this.findById(id);

    // Проверка прав
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (!deal.canBeCancelled) {
      throw new ConflictException('Cannot cancel deal in current status');
    }

    const cancelledDeal = await this.stateMachine.transition(deal, DealStatus.CANCELLED, userId);
    cancelledDeal.cancelReason = reason || null;
    cancelledDeal.cancelledAt = new Date();

    const saved = await this.dealRepository.save(cancelledDeal);

    await this.createEvent(
      DealEvent.createDealCancelled(saved.id, userId, reason),
    );

    // Нотификация контрагенту (не тому, кто отменил)
    const counterpartyId =
      deal.buyerId === userId ? deal.sellerId : deal.buyerId;
    if (counterpartyId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.cancelled',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.id}`,
          counterpartyUserId: counterpartyId,
          cancelledByUserId: userId,
          reason: reason ?? null,
        },
      });
    }

    return saved;
  }

  /**
   * Принятие сделки продавцом
   */
  async accept(id: string, sellerId: string): Promise<Deal> {
    const deal = await this.findById(id);

    if (deal.sellerId !== sellerId) {
      throw new ForbiddenException('Only seller can accept the deal');
    }

    if (deal.status !== DealStatus.PENDING_ACCEPTANCE) {
      throw new ConflictException('Deal cannot be accepted in current status');
    }

    const updated = await this.stateMachine.transition(
      deal,
      DealStatus.PENDING_PAYMENT,
      sellerId,
    );
    return this.dealRepository.save(updated);
  }

  /**
   * Отклонение сделки продавцом
   */
  async reject(id: string, sellerId: string, reason?: string): Promise<Deal> {
    const deal = await this.findById(id);

    if (deal.sellerId !== sellerId) {
      throw new ForbiddenException('Only seller can reject the deal');
    }

    if (deal.status !== DealStatus.PENDING_ACCEPTANCE) {
      throw new ConflictException('Deal cannot be rejected in current status');
    }

    const updated = await this.stateMachine.transition(deal, DealStatus.CANCELLED, sellerId);
    updated.cancelReason = reason ?? null;
    updated.cancelledAt = new Date();
    return this.dealRepository.save(updated);
  }

  /**
   * Подтверждение оплаты (вызывается после успешного платежа)
   */
  async confirmPayment(
    id: string,
    amount: number,
    currency: string,
  ): Promise<Deal> {
    const deal = await this.findById(id);

    if (deal.status === DealStatus.IN_PROGRESS || deal.status === DealStatus.COMPLETED) {
      return deal;
    }

    if (deal.status !== DealStatus.PENDING_PAYMENT) {
      throw new ConflictException('Deal is not pending payment');
    }

    const updated = await this.stateMachine.transition(
      deal,
      DealStatus.IN_PROGRESS,
    );

    await this.createEvent(
      DealEvent.createPaymentReceived(updated.id, amount, currency),
    );

    const saved = await this.dealRepository.save(updated);

    // Нотификация продавцу — деньги в эскроу, можно отгружать
    if (deal.sellerId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.payment_received',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.id}`,
          dealAmount: Number(amount),
          sellerUserId: deal.sellerId,
          buyerUserId: deal.buyerId,
        },
      });
    }

    return saved;
  }

  /**
   * Продавец отмечает отгрузку — переход в ожидание подтверждения покупателем.
   */
  async markShipped(id: string, sellerId: string): Promise<Deal> {
    const deal = await this.findById(id);
    if (deal.sellerId !== sellerId) {
      throw new ForbiddenException('Only seller can mark shipped');
    }
    if (deal.status !== DealStatus.IN_PROGRESS) {
      throw new ConflictException('Deal is not in progress');
    }
    const updated = await this.stateMachine.transition(
      deal,
      DealStatus.PENDING_CONFIRMATION,
      sellerId,
    );
    const saved = await this.dealRepository.save(updated);

    if (deal.buyerId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.confirmation_requested',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.dealNumber ?? deal.id}`,
          dealAmount: Number(deal.amount),
          buyerUserId: deal.buyerId,
          sellerUserId: deal.sellerId,
        },
      });
    }

    return saved;
  }

  /**
   * Подтверждение получения покупателем
   */
  async confirmReceipt(id: string, buyerId: string): Promise<Deal> {
    const deal = await this.findById(id);

    if (deal.buyerId !== buyerId) {
      throw new ForbiddenException('Only buyer can confirm receipt');
    }

    if (!deal.canBeConfirmed) {
      throw new ConflictException('Deal cannot be confirmed in current status');
    }

    const updated = await this.stateMachine.transition(
      deal,
      DealStatus.COMPLETED,
      buyerId,
    );

    if (deal.sellerId) {
      await this.userService.incrementDealStats(deal.sellerId, 'completed');
      await this.reputationService.onDealCompleted(deal.sellerId, deal.id);
      await this.reputationService.onDealCompleted(buyerId, deal.id);
    }

    const summary = await this.escrowService.getSummary(deal.id);
    const needsOnChainRelease =
      this.escrowService.isEnabled() && summary?.status === 'funded';

    if (needsOnChainRelease) {
      updated.metadata = {
        ...(updated.metadata ?? {}),
        escrowReleaseRequired: true,
        escrowAddress: summary.address,
      };
    }

    const saved = await this.dealRepository.save(updated);

    if (needsOnChainRelease && deal.buyerId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.release_required',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.dealNumber ?? deal.id}`,
          dealAmount: Number(deal.amount),
          buyerUserId: deal.buyerId,
          sellerUserId: deal.sellerId,
          escrowAddress: summary!.address,
        },
      });
    } else if (deal.sellerId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.completed',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.id}`,
          dealAmount: Number(deal.amount),
          sellerUserId: deal.sellerId,
          buyerUserId: deal.buyerId,
        },
      });
    }

    return saved;
  }

  /**
   * On-chain escrow snapshot for mini-app release UI.
   */
  async getEscrowForDeal(
    dealId: string,
    userId: string,
  ): Promise<{
    ready: boolean;
    chainId: number;
    escrowAddress: string | null;
    status: string;
    releaseRequired: boolean;
    releaseTxHash: string | null;
    buyerWallet: string | null;
    sellerWallet: string | null;
  }> {
    const deal = await this.findById(dealId);
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const meta = (deal.metadata ?? {}) as Record<string, unknown>;
    const summary = await this.escrowService.getSummary(dealId);
    const chainId = Number.parseInt(
      this.configService.get<string>('BLOCKCHAIN_CHAIN_ID', '80002'),
      10,
    );

    return {
      ready: this.escrowService.isEnabled(),
      chainId: Number.isFinite(chainId) ? chainId : 80002,
      escrowAddress:
        (meta.escrowAddress as string) ??
        deal.escrowAddress ??
        summary?.address ??
        null,
      status: summary?.status ?? 'unknown',
      releaseRequired: Boolean(meta.escrowReleaseRequired),
      releaseTxHash: (meta.escrowReleaseTxHash as string) ?? null,
      buyerWallet: deal.buyer?.walletAddress ?? null,
      sellerWallet: deal.seller?.walletAddress ?? null,
    };
  }

  /**
   * After buyer signs release() on-chain, sync status and notify seller.
   */
  async syncEscrowRelease(
    dealId: string,
    buyerId: string,
    txHash?: string,
  ): Promise<Deal> {
    const deal = await this.findById(dealId);

    if (deal.buyerId !== buyerId) {
      throw new ForbiddenException('Only buyer can confirm escrow release');
    }

    const meta = { ...(deal.metadata ?? {}) } as Record<string, unknown>;
    if (!meta.escrowReleaseRequired) {
      throw new BadRequestException('Escrow release is not required for this deal');
    }

    const summary = await this.escrowService.getSummary(dealId);
    if (summary?.status !== 'released') {
      throw new ConflictException(
        'Escrow is not released on-chain yet. Sign release() in your wallet first.',
      );
    }

    meta.escrowReleaseRequired = false;
    if (txHash) {
      meta.escrowReleaseTxHash = txHash;
    }
    deal.metadata = meta;
    const saved = await this.dealRepository.save(deal);

    if (deal.sellerId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.completed',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.dealNumber ?? deal.id}`,
          dealAmount: Number(deal.amount),
          sellerUserId: deal.sellerId,
          buyerUserId: deal.buyerId,
          releaseTxHash: txHash ?? meta.escrowReleaseTxHash,
        },
      });
    }

    return saved;
  }

  /**
   * Открытие спора
   */
  async openDispute(id: string, userId: string, reason: string): Promise<Deal> {
    const deal = await this.findById(id);

    if (!deal.canBeDisputed) {
      throw new ConflictException('Cannot open dispute in current status');
    }

    // Проверка прав
    if (deal.buyerId !== userId && deal.sellerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const messages = await this.getMessages(deal.id, 500, 0);
    const snapshot = messages.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      senderId: m.senderId,
      content: m.content,
    }));
    const chatSnapshotHash = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');

    deal.metadata = {
      ...(deal.metadata ?? {}),
      chatSnapshotHash,
      chatSnapshotMessageCount: messages.length,
      disputeOpenedAt: new Date().toISOString(),
    };

    deal.status = DealStatus.DISPUTED;
    deal.disputedAt = new Date();

    await this.createEvent(
      DealEvent.createDisputeOpened(deal.id, userId, reason),
    );

    // Обновляем статистику
    await this.userService.incrementDealStats(deal.buyerId, 'disputed');
    if (deal.sellerId) {
      await this.userService.incrementDealStats(deal.sellerId, 'disputed');
    }

    const saved = await this.dealRepository.save(deal);

    const opponentId =
      deal.buyerId === userId ? deal.sellerId : deal.buyerId;
    if (opponentId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'dispute.opened',
        payload: {
          dealId: deal.id,
          disputeId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.dealNumber ?? deal.id}`,
          reason,
          opponentUserId: opponentId,
        },
      });
    }

    return saved;
  }

  /**
   * Создание сообщения в сделке
   */
  async createMessage(data: CreateMessageDto): Promise<DealMessage> {
    const deal = await this.findById(data.dealId);

    // Проверка прав
    if (
      deal.buyerId !== data.senderId &&
      deal.sellerId !== data.senderId
    ) {
      throw new ForbiddenException('Access denied');
    }

    const message = this.messageRepository.create({
      deal,
      dealId: deal.id,
      senderId: data.senderId,
      content: data.content,
      type: data.type || MessageType.TEXT,
    });

    const savedMessage = await this.messageRepository.save(message);

    // Создаём событие
    await this.createEvent({
      type: DealEventType.MESSAGE_SENT,
      dealId: deal.id,
      userId: data.senderId,
      description: 'Сообщение отправлено',
    });

    return savedMessage;
  }

  /**
   * Получение сообщений сделки
   */
  async getMessages(
    dealId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<DealMessage[]> {
    return this.messageRepository.find({
      where: { dealId, isDeleted: false },
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
      relations: ['sender'],
    });
  }

  /**
   * Создание вложения
   */
  async createAttachment(data: CreateAttachmentDto): Promise<DealAttachment> {
    const deal = await this.findById(data.dealId);

    const attachment = this.attachmentRepository.create({
      deal,
      uploadedById: data.uploadedById,
      url: data.url,
      filename: data.filename,
      type: data.type,
      mimeType: data.mimeType,
      size: data.size,
      description: data.description,
      metadata: data.metadata,
      isImage: data.type === AttachmentType.IMAGE,
    });

    return this.attachmentRepository.save(attachment);
  }

  /**
   * Создание приглашения
   */
  async createInvite(
    dealId: string,
    creatorId: string,
    invitedUserId?: string,
    invitedUserTelegramId?: string,
    message?: string,
    expiresInHours: number = 72,
  ): Promise<DealInvite> {
    const deal = await this.findById(dealId);

    // Проверка прав
    if (deal.buyerId !== creatorId) {
      throw new ForbiddenException('Only buyer can create invites');
    }
    if (deal.sellerId || deal.status !== DealStatus.DRAFT) {
      throw new ConflictException('Deal already accepted');
    }

    const existingInvite = await this.inviteRepository.findOne({
      where: { dealId: deal.id, status: InviteStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
    if (existingInvite) {
      if (!existingInvite.isExpired) {
        return existingInvite;
      }
      existingInvite.expire();
      await this.inviteRepository.save(existingInvite);
    }

    const inviteToken = DealInvite.generateToken();
    const inviteUrl = DealInvite.generateInviteUrl(
      process.env.APP_URL || 'https://t.me/garant_bot',
      inviteToken,
    );

    const invite = this.inviteRepository.create({
      deal,
      dealId: deal.id,
      invitedUserId,
      invitedUserTelegramId,
      inviteToken,
      inviteUrl,
      message,
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
    });

    const savedInvite = await this.inviteRepository.save(invite);

    // Создаём событие
    await this.createEvent(
      DealEvent.createCounterpartyInvited(dealId, creatorId),
    );

    return savedInvite;
  }

  /**
   * Принятие приглашения
   */
  async acceptInvite(token: string, userId: string): Promise<DealInvite> {
    const { savedInvite, deal } = await this.dataSource.transaction(async (manager) => {
      const inviteRepo = manager.getRepository(DealInvite);
      const dealRepo = manager.getRepository(Deal);

      const invite = await inviteRepo.findOne({
        where: { inviteToken: token },
        relations: ['deal'],
      });

      if (!invite) {
        throw new NotFoundException('Invite not found');
      }

      if (!invite.isValid) {
        throw new ConflictException('Invite is not valid');
      }

      const deal = invite.deal ?? (await dealRepo.findOne({ where: { id: invite.dealId } }));
      if (!deal) {
        throw new NotFoundException('Deal not found');
      }

      if (deal.buyerId === userId) {
        throw new ForbiddenException('Buyer cannot accept own invitation');
      }
      if (deal.sellerId && deal.sellerId !== userId) {
        throw new ConflictException('Deal already accepted');
      }
      if (deal.status !== DealStatus.DRAFT && deal.status !== DealStatus.PENDING_PAYMENT) {
        throw new ConflictException('Invite is not valid');
      }
      if (deal.status === DealStatus.PENDING_PAYMENT && deal.sellerId === userId) {
        return { savedInvite: invite, deal };
      }

      invite.accept();
      invite.invitedUserId = userId;
      const savedInvite = await inviteRepo.save(invite);

      deal.sellerId = userId;
      deal.status = DealStatus.PENDING_PAYMENT;
      deal.acceptedAt = new Date();
      await dealRepo.save(deal);

      await inviteRepo
        .createQueryBuilder()
        .update(DealInvite)
        .set({ status: InviteStatus.CANCELLED })
        .where('deal_id = :dealId', { dealId: deal.id })
        .andWhere('id != :inviteId', { inviteId: savedInvite.id })
        .andWhere('status = :status', { status: InviteStatus.PENDING })
        .execute();

      return { savedInvite, deal };
    });

    // Создаём событие
    await this.createEvent(
      DealEvent.createCounterpartyAccepted(savedInvite.dealId, userId),
    );

    // Нотификация покупателю — контрагент принял приглашение
    if (deal.buyerId) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'invite.accepted',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.id}`,
          dealAmount: Number(deal.amount),
          buyerUserId: deal.buyerId,
          sellerUserId: userId,
        },
      });
    }

    return savedInvite;
  }

  /**
   * Получение приглашения по токену
   */
  async getInviteByToken(token: string): Promise<DealInvite> {
    const invite = await this.inviteRepository.findOne({
      where: { inviteToken: token },
      relations: ['deal', 'deal.buyer', 'invitedUser'],
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    // Увеличиваем счётчик просмотров
    invite.incrementViewCount();
    await this.inviteRepository.save(invite);

    return invite;
  }

  /**
   * Получение статистики пользователя по сделкам
   */
  async getUserStats(userId: string): Promise<{
    totalDeals: number;
    activeDeals: number;
    completedDeals: number;
    totalAmount: number;
    asBuyer: number;
    asSeller: number;
  }> {
    const query = this.dealRepository
      .createQueryBuilder('deal')
      .where('deal.buyerId = :userId OR deal.sellerId = :userId', { userId });

    const totalDeals = await query.getCount();

    const activeDeals = await query
      .clone()
      .andWhere('deal.status IN (:...statuses)', {
        statuses: [
          DealStatus.DRAFT,
          DealStatus.PENDING_ACCEPTANCE,
          DealStatus.PENDING_PAYMENT,
          DealStatus.IN_PROGRESS,
          DealStatus.PENDING_CONFIRMATION,
        ],
      })
      .getCount();

    const completedDeals = await query
      .clone()
      .andWhere('deal.status = :status', { status: DealStatus.COMPLETED })
      .getCount();

    const totalAmountResult = await query
      .clone()
      .select('SUM(deal.amount)', 'total')
      .andWhere('deal.status = :status', { status: DealStatus.COMPLETED })
      .getRawOne();

    const asBuyer = await query
      .clone()
      .andWhere('deal.buyerId = :userId', { userId })
      .getCount();

    const asSeller = await query
      .clone()
      .andWhere('deal.sellerId = :userId', { userId })
      .getCount();

    return {
      totalDeals,
      activeDeals,
      completedDeals,
      totalAmount: parseFloat(totalAmountResult?.total || 0),
      asBuyer,
      asSeller,
    };
  }

  /**
   * Генерация номера сделки
   */
  private async generateDealNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');

    const lastDeal = await this.dealRepository.findOne({
      where: {
        dealNumber: `${year}${month}-%`,
      },
      order: { dealNumber: 'DESC' },
    });

    let sequence = 1;
    if (lastDeal) {
      const lastSequence = parseInt(lastDeal.dealNumber.split('-')[2], 10);
      sequence = lastSequence + 1;
    }

    return `${year}${month}-${sequence.toString().padStart(4, '0')}`;
  }

  /**
   * Создание события
   */
  private async createEvent(
    data: Partial<DealEvent>,
  ): Promise<DealEvent> {
    const event = this.eventRepository.create(data);
    return this.eventRepository.save(event);
  }

  /**
   * Получение событий сделки
   */
  async getEvents(dealId: string, limit: number = 50): Promise<DealEvent[]> {
    return this.eventRepository.find({
      where: { dealId },
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['user'],
    });
  }

  async findAllForAdmin(
    page: number = 1,
    limit: number = 20,
    filter?: { status?: string; type?: string },
  ): Promise<{ deals: Deal[]; total: number }> {
    const query = this.dealRepository.createQueryBuilder('deal')
      .leftJoinAndSelect('deal.buyer', 'buyer')
      .leftJoinAndSelect('deal.seller', 'seller');

    if (filter?.status) {
      query.andWhere('deal.status = :status', { status: filter.status });
    }
    if (filter?.type) {
      query.andWhere('deal.type = :type', { type: filter.type });
    }

    const skip = (page - 1) * limit;
    query.skip(skip).take(limit).orderBy('deal.createdAt', 'DESC');

    const [deals, total] = await query.getManyAndCount();
    return { deals, total };
  }

  async forceComplete(id: string): Promise<Deal> {
    const deal = await this.findById(id);
    deal.status = DealStatus.COMPLETED;
    deal.completedAt = new Date();
    return this.dealRepository.save(deal);
  }

  async forceCancel(id: string, reason: string): Promise<Deal> {
    const deal = await this.findById(id);
    deal.status = DealStatus.CANCELLED;
    deal.cancelReason = reason;
    deal.cancelledAt = new Date();
    return this.dealRepository.save(deal);
  }

  async getDealMessages(dealId: string, limit: number = 50, offset: number = 0): Promise<DealMessage[]> {
    return this.getMessages(dealId, limit, offset);
  }
}
