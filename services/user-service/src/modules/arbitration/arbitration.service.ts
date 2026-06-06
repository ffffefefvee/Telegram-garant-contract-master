import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArbitrationDecision } from './entities/arbitration-decision.entity';
import { Appeal } from './entities/appeal.entity';
import { ArbitrationChatMessage } from './entities/arbitration-chat-message.entity';
import { DealTerms } from './entities/deal-terms.entity';
import { Dispute } from './entities/dispute.entity';
import { ArbitrationDecisionType } from './entities/enums/arbitration.enum';
import {
  MakeDecisionDto,
  FileAppealDto,
  ReviewAppealDto,
  ArbitrationChatMessageDto,
  DealTermsDto,
  EnforceDecisionDto,
} from './dto';
import { ArbitrationSettingsService } from './arbitration-settings.service';
import { DisputeService } from './dispute.service';
import { EvidenceService } from './evidence.service';
import { ArbitratorService } from './arbitrator.service';
import { OutboxService } from '../ops/outbox.service';

/**
 * Основной сервис арбитража
 * Координирует работу всех подсервисов
 */
@Injectable()
export class ArbitrationService {
  constructor(
    @InjectRepository(ArbitrationDecision)
    private readonly decisionRepository: Repository<ArbitrationDecision>,
    @InjectRepository(Appeal)
    private readonly appealRepository: Repository<Appeal>,
    @InjectRepository(ArbitrationChatMessage)
    private readonly chatMessageRepository: Repository<ArbitrationChatMessage>,
    @InjectRepository(DealTerms)
    private readonly dealTermsRepository: Repository<DealTerms>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    private readonly settingsService: ArbitrationSettingsService,
    private readonly disputeService: DisputeService,
    private readonly evidenceService: EvidenceService,
    private readonly arbitratorService: ArbitratorService,
    private readonly outbox: OutboxService,
  ) {}

  // === Deal Terms ===

  /**
   * Создать или обновить условия сделки
   */
  async createOrUpdateDealTerms(
    dealId: string,
    dto: DealTermsDto,
  ): Promise<DealTerms> {
    let dealTerms = await this.dealTermsRepository.findOne({
      where: { dealId },
    });

    if (dealTerms) {
      // Обновление
      Object.assign(dealTerms, dto);
      dealTerms.updatedAt = new Date();
    } else {
      // Создание
      dealTerms = this.dealTermsRepository.create({
        dealId,
        ...dto,
        requiredEvidence: dto.requiredEvidence ? JSON.stringify(dto.requiredEvidence) : null,
      });
    }

    return this.dealTermsRepository.save(dealTerms);
  }

  /**
   * Получить условия сделки
   */
  async getDealTerms(dealId: string): Promise<DealTerms | null> {
    return this.dealTermsRepository.findOne({
      where: { dealId },
    });
  }

  // === Arbitration Decision ===

  /**
   * Вынести решение по спору
   */
  async makeDecision(
    disputeId: string,
    arbitratorUserId: string,
    dto: MakeDecisionDto,
  ): Promise<ArbitrationDecision> {
    const dispute = await this.disputeService.getDispute(disputeId);

    // Проверка что пользователь арбитр
    if (dispute.arbitratorId !== arbitratorUserId) {
      throw new Error('Only arbitrator can make decision');
    }

    // Проверка статуса
    if (dispute.status !== 'under_review' as any) {
      throw new Error('Dispute is not under review');
    }

    // Получение настроек
    const penaltyPercent = await this.settingsService.getPenaltyPercent();
    const arbitratorFeePercent = await this.settingsService.getArbitratorFeePercent();
    const platformFeePercent = await this.settingsService.getPlatformFeePercent();
    const appealHours = dto.appealPeriodHours || await this.settingsService.getAppealWindowHours();

    // Расчёт сумм
    const dealAmount = dispute.deal?.amount || 0;
    const distribution = ArbitrationDecision.calculateDistribution(
      dealAmount,
      dto.decisionType,
      penaltyPercent,
    );

    // Расчёт комиссий
    const totalPenalty = distribution.penalty;
    const arbitratorFee = totalPenalty * arbitratorFeePercent;
    const platformFee = totalPenalty * platformFeePercent;

    const decision = this.decisionRepository.create({
      disputeId,
      arbitratorId: arbitratorUserId,
      decisionType: dto.decisionType,
      reasoning: dto.reasoning,
      comments: dto.comments,
      refundToBuyer: distribution.refundToBuyer,
      paymentToSeller: distribution.paymentToSeller,
      penaltyAmount: totalPenalty,
      arbitratorFee,
      platformFee,
      penaltyReason: totalPenalty > 0 ? 'Нарушение условий сделки' : null,
      isAppealable: dto.isAppealable ?? true,
      appealPeriodHours: dto.appealPeriodHours || appealHours,
    });

    await this.decisionRepository.save(decision);

    // Обновление спора
    dispute.decisionId = decision.id;
    dispute.status = 'decision_made' as any;
    dispute.penaltyAmount = totalPenalty;
    dispute.arbitratorFee = arbitratorFee;
    dispute.platformFee = platformFee;
    dispute.isAppealable = dto.isAppealable ?? true;
    dispute.appealDueAt = new Date(Date.now() + appealHours * 60 * 60 * 1000);
    dispute.resolvedAt = new Date();

    await this.disputeRepository.save(dispute);

    // Обновление статистики арбитра
    await this.arbitratorService.completeCase(arbitratorUserId, arbitratorFee);

    // Нотификация buyer + seller о принятом решении
    await this.outbox.enqueue({
      aggregateType: 'dispute',
      aggregateId: disputeId,
      eventType: 'dispute.decision_made',
      payload: {
        disputeId,
        dealTitle: dispute.deal?.title ?? `Deal ${dispute.dealId}`,
        buyerUserId: dispute.deal?.buyerId ?? null,
        sellerUserId: dispute.deal?.sellerId ?? null,
        buyerShare: distribution.refundToBuyer,
        sellerShare: distribution.paymentToSeller,
        decisionType: dto.decisionType,
      },
    });

    return decision;
  }

  /**
   * Исполнить решение
   */
  async enforceDecision(
    decisionId: string,
    userId: string,
    dto?: EnforceDecisionDto,
  ): Promise<ArbitrationDecision> {
    const decision = await this.decisionRepository.findOne({
      where: { id: decisionId },
      relations: ['dispute'],
    });

    if (!decision) {
      throw new Error('Decision not found');
    }

    if (decision.isEnforced) {
      throw new Error('Decision already enforced');
    }

    // Проверка что апелляция не подана или период истёк
    if (decision.canBeAppealed) {
      // Можно исполнить только если период апелляции истёк
      const appealDeadline = new Date(
        decision.createdAt.getTime() + decision.appealPeriodHours * 60 * 60 * 1000,
      );
      if (new Date() < appealDeadline) {
        throw new Error('Appeal period has not expired');
      }
    }

    decision.enforce(userId);
    await this.decisionRepository.save(decision);

    // Обновление спора
    const dispute = decision.dispute;
    dispute.status = 'enforced' as any;
    dispute.enforcedAt = new Date();
    await this.disputeRepository.save(dispute);

    // Здесь будет интеграция с PaymentService для распределения средств

    return decision;
  }

  /**
   * Получить решение
   */
  async getDecision(decisionId: string): Promise<ArbitrationDecision> {
    const decision = await this.decisionRepository.findOne({
      where: { id: decisionId },
      relations: ['dispute', 'arbitrator'],
    });

    if (!decision) {
      throw new Error('Decision not found');
    }

    return decision;
  }

  // === Appeal ===

  /**
   * Подать апелляцию
   */
  async fileAppeal(
    disputeId: string,
    appellantUserId: string,
    dto: FileAppealDto,
  ): Promise<Appeal> {
    const dispute = await this.disputeService.getDispute(disputeId);

    if (!dispute.canTransitionToAppeal) {
      throw new Error('This dispute cannot be appealed');
    }

    if (!dispute.decision) {
      throw new Error('No decision to appeal');
    }

    if (!dispute.decision.canBeAppealed) {
      throw new Error('Decision is not appealable');
    }

    // Проверка_deposit
    const depositAmount = dto.depositAmount || await this.settingsService.getAppealDepositAmount();

    const appeal = this.appealRepository.create({
      disputeId,
      appellantId: appellantUserId,
      originalDecisionId: dispute.decision.id,
      reason: dto.reason,
      newEvidence: dto.newEvidence,
      depositAmount,
      status: 'pending',
    });

    await this.appealRepository.save(appeal);

    // Обновление спора
    dispute.appealId = appeal.id;
    dispute.status = 'appealed' as any;
    dispute.appealedAt = new Date();
    await this.disputeRepository.save(dispute);

    // Обновление статистики арбитра
    if (dispute.arbitratorId) {
      await this.arbitratorService.addAppeal(dispute.arbitratorId);
    }

    return appeal;
  }

  /**
   * Рассмотреть апелляцию (старший арбитр)
   */
  async reviewAppeal(
    appealId: string,
    reviewerUserId: string,
    dto: ReviewAppealDto,
  ): Promise<Appeal> {
    const appeal = await this.appealRepository.findOne({
      where: { id: appealId },
      relations: ['dispute'],
    });

    if (!appeal) {
      throw new Error('Appeal not found');
    }

    if (appeal.status !== 'pending' && appeal.status !== 'under_review') {
      throw new Error('Appeal is not pending review');
    }

    const refundDeposit = dto.refundDeposit ?? true;

    if (dto.decision === 'approved') {
      appeal.approve(dto.reviewDecision, refundDeposit);
    } else {
      appeal.reject(dto.reviewDecision, refundDeposit);
    }

    await this.appealRepository.save(appeal);

    // Если апелляция удовлетворена - отмена решения
    if (dto.decision === 'approved' && appeal.dispute) {
      const dispute = appeal.dispute;
      dispute.status = 'under_review' as any;
      dispute.appealId = null;
      await this.disputeRepository.save(dispute);

      // Обновление статистики оригинального арбитра
      if (appeal.originalDecision?.arbitratorId) {
        await this.arbitratorService.addOverturn(appeal.originalDecision.arbitratorId);
      }
    }

    return appeal;
  }

  /**
   * Отозвать апелляцию
   */
  async withdrawAppeal(appealId: string, appellantUserId: string): Promise<Appeal> {
    const appeal = await this.appealRepository.findOne({
      where: { id: appealId },
    });

    if (!appeal) {
      throw new Error('Appeal not found');
    }

    if (appeal.appellantId !== appellantUserId) {
      throw new Error('Only appellant can withdraw appeal');
    }

    appeal.withdraw();
    return this.appealRepository.save(appeal);
  }

  // === Arbitration Chat ===

  /**
   * Отправить сообщение в чат арбитража
   */
  async sendChatMessage(
    disputeId: string,
    senderId: string,
    dto: ArbitrationChatMessageDto,
  ): Promise<ArbitrationChatMessage> {
    const dispute = await this.disputeService.getDispute(disputeId);

    if (!dispute.chat) {
      throw new Error('Chat not found');
    }

    const message = this.chatMessageRepository.create({
      chatId: dispute.chat.id,
      senderId,
      content: dto.content,
      attachments: dto.attachments ? JSON.stringify(dto.attachments) : null,
    });

    await this.chatMessageRepository.save(message);

    // Обновление чата
    dispute.chat.addMessage(dto.content, false, false, false);
    await this.chatMessageRepository.manager.save(dispute.chat);

    return message;
  }

  /**
   * Получить сообщения чата
   */
  async getChatMessages(chatId: string, limit: number = 50): Promise<ArbitrationChatMessage[]> {
    return this.chatMessageRepository.find({
      where: { chatId },
      relations: ['sender'],
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Отметить сообщения как прочитанные
   */
  async markChatAsRead(chatId: string, userId: string, role: 'buyer' | 'seller' | 'arbitrator'): Promise<void> {
    // Реализация через chatRepository
  }
}
