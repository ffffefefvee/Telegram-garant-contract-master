import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Dispute } from './entities/dispute.entity';
import { ArbitrationChat } from './entities/arbitration-chat.entity';
import { ArbitrationEvent } from './entities/arbitration-event.entity';
import { Deal } from '../deal/entities/deal.entity';
import { User } from '../user/entities/user.entity';
import {
  DisputeStatus,
  DisputeType,
  DisputeSide,
  ArbitrationEventType,
} from './entities/enums/arbitration.enum';
import { OpenDisputeDto, AssignArbitratorDto, UpdateDisputeStatusDto } from './dto';
import { ArbitrationSettingsService } from './arbitration-settings.service';
import { OutboxService } from '../ops/outbox.service';

/**
 * Сервис для управления спорами (FSM)
 */
@Injectable()
export class DisputeService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(ArbitrationChat)
    private readonly chatRepository: Repository<ArbitrationChat>,
    @InjectRepository(ArbitrationEvent)
    private readonly eventRepository: Repository<ArbitrationEvent>,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly settingsService: ArbitrationSettingsService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Открыть спор
   */
  async openDispute(
    dealId: string,
    userId: string,
    dto: OpenDisputeDto,
  ): Promise<Dispute> {
    const deal = await this.dealRepository.findOne({
      where: { id: dealId },
      relations: ['buyer', 'seller'],
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    // Проверка что пользователь является стороной сделки
    const isBuyer = deal.buyerId === userId;
    const isSeller = deal.sellerId === userId;

    if (!isBuyer && !isSeller) {
      throw new ForbiddenException('You are not a party to this deal');
    }

    // Проверка что сделка может быть оспорена
    if (!deal.canBeDisputed) {
      throw new ForbiddenException('This deal cannot be disputed');
    }

    // Проверка что спор ещё не открыт
    const existingDispute = await this.disputeRepository.findOne({
      where: { dealId },
    });

    if (existingDispute && !existingDispute.isClosed) {
      throw new ConflictException('Dispute already exists for this deal');
    }

    // Получение настроек
    const penaltyPercent = await this.settingsService.getPenaltyPercent();
    const evidenceHours = await this.settingsService.getEvidenceSubmissionHours();

    // Создание спора
    const dispute = this.disputeRepository.create({
      disputeNumber: Dispute.generateDisputeNumber(),
      dealId,
      openerId: userId,
      openedBy: dto.openedBy,
      type: dto.type,
      status: DisputeStatus.OPENED,
      reason: dto.reason,
      description: dto.description,
      claimedAmount: dto.claimedAmount,
      penaltyPercent: dto.penaltyPercent || penaltyPercent,
      evidenceDueAt: new Date(Date.now() + evidenceHours * 60 * 60 * 1000),
    });

    // Создание чата для спора
    const chat = this.chatRepository.create({
      disputeId: dispute.id, // Will be set after save
    });

    // Сохранение в транзакции
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(dispute);
      
      chat.disputeId = dispute.id;
      await queryRunner.manager.save(chat);
      
      dispute.chatId = chat.id;
      await queryRunner.manager.save(dispute);

      // Создание события
      const event = this.eventRepository.create({
        disputeId: dispute.id,
        type: ArbitrationEventType.DISPUTE_OPENED,
        description: `Спор открыт: ${dto.reason}`,
        actorId: userId,
        metadata: {
          type: dto.type,
          openedBy: dto.openedBy,
        },
      });
      await queryRunner.manager.save(event);

      // Обновление статуса сделки
      deal.status = 'DISPUTED' as any;
      deal.disputedAt = new Date();
      await queryRunner.manager.save(deal);

      // Нотификация оппоненту (не открывшему спор)
      const opponentUserId = isBuyer ? deal.sellerId : deal.buyerId;
      await this.outbox.enqueue({
        aggregateType: 'dispute',
        aggregateId: dispute.id,
        eventType: 'dispute.opened',
        payload: {
          disputeId: dispute.id,
          dealId: deal.id,
          dealTitle: deal.title ?? `Deal ${deal.id}`,
          reason: dto.reason,
          openerUserId: userId,
          opponentUserId,
        },
        manager: queryRunner.manager,
      });

      await queryRunner.commitTransaction();

      // Загрузка отношений
      const savedDispute = await this.disputeRepository.findOne({
        where: { id: dispute.id },
        relations: ['deal', 'opener', 'chat'],
      });
      
      if (!savedDispute) {
        throw new NotFoundException('Dispute not found after creation');
      }
      
      return savedDispute;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Назначить арбитра
   */
  async assignArbitrator(
    disputeId: string,
    arbitratorUserId: string,
    assignedByUserId: string,
    isAutoAssigned: boolean = false,
  ): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
      relations: ['deal', 'opener'],
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    if (!dispute.isOpen) {
      throw new ForbiddenException('Dispute is not open for arbitrator assignment');
    }

    // Проверка что арбитр существует и активен
    const arbitrator = await this.userRepository.findOne({ where: { id: arbitratorUserId } });
    if (!arbitrator) {
      throw new NotFoundException('Arbitrator not found');
    }

    const assignmentTimeout = await this.settingsService.getArbitratorAssignmentTimeoutHours();
    const decisionHours = await this.settingsService.getDecisionDeadlineHours();

    dispute.arbitratorId = arbitratorUserId;
    dispute.arbitratorAssignedAt = new Date();
    dispute.status = DisputeStatus.UNDER_REVIEW;
    dispute.decisionDueAt = new Date(Date.now() + decisionHours * 60 * 60 * 1000);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(dispute);

      // Создание события
      const event = this.eventRepository.create({
        disputeId: dispute.id,
        type: ArbitrationEventType.ARBITRATOR_ASSIGNED,
        description: isAutoAssigned ? 'Арбитр назначен автоматически' : 'Арбитр назначен',
        actorId: assignedByUserId,
        metadata: {
          arbitratorId: arbitratorUserId,
          arbitratorName: arbitrator.telegramFirstName || arbitrator.telegramUsername || 'Unknown',
          isAutoAssigned,
        },
      });
      await queryRunner.manager.save(event);

      // Нотификация арбитру
      await this.outbox.enqueue({
        aggregateType: 'dispute',
        aggregateId: dispute.id,
        eventType: 'dispute.arbitrator_assigned',
        payload: {
          disputeId: dispute.id,
          dealTitle: dispute.deal?.title ?? `Deal ${dispute.dealId}`,
          dealAmount: dispute.deal?.amount ?? null,
          arbitratorUserId,
          decisionDueAt: dispute.decisionDueAt?.toISOString() ?? null,
          isAutoAssigned,
        },
        manager: queryRunner.manager,
      });

      await queryRunner.commitTransaction();

      const savedDispute = await this.disputeRepository.findOne({
        where: { id: dispute.id },
        relations: ['deal', 'opener', 'arbitrator'],
      });
      
      if (!savedDispute) {
        throw new NotFoundException('Dispute not found after assignment');
      }
      
      return savedDispute;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Изменить статус спора
   */
  async updateStatus(
    disputeId: string,
    userId: string,
    dto: UpdateDisputeStatusDto,
  ): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
      relations: ['arbitrator'],
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Проверка прав
    const isArbitrator = dispute.arbitratorId === userId;
    if (!isArbitrator) {
      throw new ForbiddenException('Only arbitrator can update dispute status');
    }

    // Проверка перехода
    if (!dispute.canTransitionTo(dto.status)) {
      throw new ForbiddenException(`Cannot transition from ${dispute.status} to ${dto.status}`);
    }

    const oldStatus = dispute.status;
    dispute.status = dto.status;

    if (dto.resolution) {
      dispute.resolution = dto.resolution;
    }

    // Определение типа события
    let eventType: ArbitrationEventType;
    switch (dto.status) {
      case DisputeStatus.UNDER_REVIEW:
        eventType = ArbitrationEventType.DISPUTE_OPENED;
        break;
      case DisputeStatus.DECISION_MADE:
        eventType = ArbitrationEventType.DECISION_MADE;
        break;
      case DisputeStatus.ENFORCED:
        eventType = ArbitrationEventType.DECISION_ENFORCED;
        break;
      case DisputeStatus.CLOSED:
        eventType = ArbitrationEventType.DISPUTE_CLOSED;
        dispute.closedAt = new Date();
        break;
      default:
        eventType = ArbitrationEventType.DISPUTE_OPENED;
    }

    const event = this.eventRepository.create({
      disputeId: dispute.id,
      type: eventType,
      description: `Статус изменён с ${oldStatus} на ${dto.status}`,
      actorId: userId,
      metadata: { oldStatus, newStatus: dto.status },
    });

    await this.eventRepository.save(event);
    return this.disputeRepository.save(dispute);
  }

  /**
   * Получить спор по ID
   */
  async getDispute(disputeId: string): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
      relations: [
        'deal',
        'opener',
        'arbitrator',
        'evidence',
        'chat',
        'decision',
        'events',
        'appeal',
      ],
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    return dispute;
  }

  /**
   * Получить все споры пользователя
   */
  async getUserDisputes(userId: string): Promise<Dispute[]> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Споры где пользователь opener, arbitrator, или сторона сделки
    const disputes = await this.disputeRepository
      .createQueryBuilder('dispute')
      .leftJoinAndSelect('dispute.deal', 'deal')
      .leftJoinAndSelect('dispute.opener', 'opener')
      .leftJoinAndSelect('dispute.arbitrator', 'arbitrator')
      .leftJoinAndSelect('dispute.chat', 'chat')
      .where('dispute.openerId = :userId', { userId })
      .orWhere('dispute.arbitratorId = :userId', { userId })
      .orWhere('deal.buyerId = :userId', { userId })
      .orWhere('deal.sellerId = :userId', { userId })
      .orderBy('dispute.createdAt', 'DESC')
      .getMany();

    return disputes;
  }

  /**
   * Получить активные споры арбитра
   */
  async getArbitratorActiveDisputes(arbitratorUserId: string): Promise<Dispute[]> {
    return this.disputeRepository.find({
      where: {
        arbitratorId: arbitratorUserId,
        status: DisputeStatus.UNDER_REVIEW,
      },
      relations: ['deal', 'opener'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Закрыть спор
   */
  async closeDispute(disputeId: string, userId: string, reason?: string): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);

    if (!dispute.isClosed && dispute.status !== DisputeStatus.ENFORCED) {
      throw new ForbiddenException('Cannot close dispute that is not enforced or closed');
    }

    dispute.closedAt = new Date();
    dispute.resolution = reason || dispute.resolution;

    const event = this.eventRepository.create({
      disputeId: dispute.id,
      type: ArbitrationEventType.DISPUTE_CLOSED,
      description: reason || 'Спор закрыт',
      actorId: userId,
    });

    await this.eventRepository.save(event);
    return this.disputeRepository.save(dispute);
  }

  /**
   * Проверить права доступа к спору
   */
  async checkAccess(disputeId: string, userId: string): Promise<{
    canAccess: boolean;
    role: 'opener' | 'opponent' | 'arbitrator' | 'admin' | 'none';
  }> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
      relations: ['deal'],
    });

    if (!dispute) {
      return { canAccess: false, role: 'none' };
    }

    // Проверка ролей
    if (dispute.openerId === userId) {
      return { canAccess: true, role: 'opener' };
    }

    if (dispute.arbitratorId === userId) {
      return { canAccess: true, role: 'arbitrator' };
    }

    if (dispute.deal) {
      if (dispute.deal.buyerId === userId || dispute.deal.sellerId === userId) {
        return { canAccess: true, role: 'opponent' };
      }
    }

    // Admin проверка будет в guard
    return { canAccess: false, role: 'none' };
  }

  async findAllForAdmin(
    page: number = 1,
    limit: number = 20,
    filter?: { status?: string; type?: string },
  ): Promise<{ disputes: Dispute[]; total: number }> {
    const query = this.disputeRepository.createQueryBuilder('dispute')
      .leftJoinAndSelect('dispute.deal', 'deal')
      .leftJoinAndSelect('deal.buyer', 'buyer')
      .leftJoinAndSelect('deal.seller', 'seller');

    if (filter?.status) {
      query.andWhere('dispute.status = :status', { status: filter.status });
    }
    if (filter?.type) {
      query.andWhere('dispute.type = :type', { type: filter.type });
    }

    const skip = (page - 1) * limit;
    query.skip(skip).take(limit).orderBy('dispute.createdAt', 'DESC');

    const [disputes, total] = await query.getManyAndCount();
    return { disputes, total };
  }

  async findByIdAdmin(id: string): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id },
      relations: ['deal', 'deal.buyer', 'deal.seller'],
    });
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }
    return dispute;
  }

  async reassignArbitratorAdmin(id: string, arbitratorId: string): Promise<Dispute> {
    const dispute = await this.findByIdAdmin(id);
    dispute.arbitratorId = arbitratorId;
    return this.disputeRepository.save(dispute);
  }

  async forceCloseAdmin(id: string, reason: string): Promise<Dispute> {
    const dispute = await this.findByIdAdmin(id);
    dispute.resolution = reason;
    dispute.closedAt = new Date();
    return this.disputeRepository.save(dispute);
  }

  async getAdminStats(): Promise<{ openDisputes: number; totalDisputes: number }> {
    const openDisputes = await this.disputeRepository.count({
      where: { isClosed: false },
    });
    const totalDisputes = await this.disputeRepository.count();
    return { openDisputes, totalDisputes };
  }
}
