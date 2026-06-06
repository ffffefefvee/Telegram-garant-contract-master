import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ArbitratorProfile } from './entities/arbitrator-profile.entity';
import { User } from '../user/entities/user.entity';
import { ArbitratorAvailability, ArbitratorStatus } from './entities/enums/arbitration.enum';
import { OutboxService } from '../ops/outbox.service';
import { AuditLogService } from '../ops/audit-log.service';
import { ArbitrationSettingsService } from './arbitration-settings.service';

/**
 * Сервис для управления арбитрами
 */
@Injectable()
export class ArbitratorService {
  constructor(
    @InjectRepository(ArbitratorProfile)
    private readonly profileRepository: Repository<ArbitratorProfile>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly settingsService: ArbitrationSettingsService,
    private readonly outbox: OutboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Создать профиль арбитра
   */
  async createProfile(userId: string): Promise<ArbitratorProfile> {
    const existing = await this.profileRepository.findOne({ where: { userId } });
    if (existing) {
      return existing;
    }

    const profile = this.profileRepository.create({
      userId,
      status: ArbitratorStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return this.profileRepository.save(profile);
  }

  /**
   * Получить профиль арбитра
   */
  async getProfile(userId: string): Promise<ArbitratorProfile> {
    const profile = await this.profileRepository.findOne({
      where: { userId },
      relations: ['user'],
    });

    if (!profile) {
      throw new NotFoundException('Arbitrator profile not found');
    }

    return profile;
  }

  /**
   * Проверить может ли пользователь быть арбитром
   */
  async canBeArbitrator(userId: string): Promise<{ can: boolean; reasons: string[] }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['reputationScores'],
    });

    if (!user) {
      return { can: false, reasons: ['User not found'] };
    }

    const reasons: string[] = [];

    // Проверка репутации
    const minReputation = await this.settingsService.getArbitratorMinReputation();
    if (user.reputationScore < minReputation) {
      reasons.push(`Minimum reputation required: ${minReputation}, your: ${user.reputationScore}`);
    }

    // Проверка количества сделок
    const minDeals = await this.settingsService.getArbitratorMinDeals();
    if (user.completedDeals < minDeals) {
      reasons.push(`Minimum deals required: ${minDeals}, your: ${user.completedDeals}`);
    }

    // Проверка уровня доверия (пока используем reputationScore как proxy)
    const minTrustLevel = await this.settingsService.getArbitratorMinTrustLevel();
    // Trust Level вычисляется из reputationScore
    // New (0-199), Basic (200-399), Verified (400-599), Experienced (600-799), Expert (800+)
    const userTrustLevel = Math.floor(user.reputationScore / 200);
    if (userTrustLevel < minTrustLevel) {
      reasons.push(`Minimum trust level required: ${minTrustLevel}, your: ${userTrustLevel}`);
    }

    // Проверка верификации
    const verificationRequired = await this.settingsService.isArbitratorVerificationRequired();
    if (verificationRequired && !user.isVerified) {
      reasons.push('Verification is required');
    }

    return {
      can: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Подать заявку на арбитра
   */
  async applyForArbitrator(
    userId: string,
    specialization?: string[],
    bio?: string,
    languages?: string[],
  ): Promise<ArbitratorProfile> {
    // Проверка возможности
    const { can, reasons } = await this.canBeArbitrator(userId);
    if (!can) {
      throw new ForbiddenException(`Cannot apply: ${reasons.join(', ')}`);
    }

    let profile = await this.profileRepository.findOne({ where: { userId } });

    if (!profile) {
      profile = await this.createProfile(userId);
    }

    // Обновление профиля
    if (specialization && specialization.length > 0) {
      if (!ArbitratorProfile.validateSpecialization(specialization)) {
        throw new BadRequestException('Invalid specialization');
      }
      profile.specialization = JSON.stringify(specialization);
    }

    if (bio) {
      profile.bio = bio;
    }

    if (languages && languages.length > 0) {
      profile.languages = JSON.stringify(languages);
    }

    profile.status = ArbitratorStatus.PENDING;
    profile.updatedAt = new Date();

    return this.profileRepository.save(profile);
  }

  /**
   * Одобрить арбитра (Admin only)
   */
  async approveArbitrator(adminId: string, arbitratorUserId: string): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    if (profile.status !== ArbitratorStatus.PENDING) {
      throw new BadRequestException('Arbitrator is not in pending status');
    }

    // Установка залога
    const depositAmount = await this.settingsService.getArbitratorDepositAmount();
    profile.setDeposit(depositAmount);

    profile.activate();
    profile.approvedById = adminId;
    profile.updatedAt = new Date();

    const saved = await this.profileRepository.save(profile);
    await this.auditLog.write({
      actorId: adminId,
      actorRole: 'admin',
      aggregateType: 'arbitrator',
      aggregateId: profile.id,
      action: 'arbitrator.approved',
      details: { arbitratorUserId, depositAmount: depositAmount.toString() },
    });
    return saved;
  }

  /**
   * Отклонить заявку (Admin only)
   */
  async rejectArbitrator(adminId: string, arbitratorUserId: string): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    if (profile.status !== ArbitratorStatus.PENDING) {
      throw new BadRequestException('Arbitrator is not in pending status');
    }

    profile.reject();
    profile.updatedAt = new Date();

    const saved = await this.profileRepository.save(profile);
    await this.auditLog.write({
      actorId: adminId,
      actorRole: 'admin',
      aggregateType: 'arbitrator',
      aggregateId: profile.id,
      action: 'arbitrator.rejected',
      details: { arbitratorUserId },
    });
    return saved;
  }

  /**
   * Приостановить арбитра (Admin only)
   */
  async suspendArbitrator(
    adminId: string,
    arbitratorUserId: string,
    reason: string,
  ): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    if (profile.status !== ArbitratorStatus.ACTIVE) {
      throw new BadRequestException('Arbitrator is not active');
    }

    profile.suspend(reason, adminId);
    profile.updatedAt = new Date();

    const saved = await this.profileRepository.save(profile);
    await this.auditLog.write({
      actorId: adminId,
      actorRole: 'admin',
      aggregateType: 'arbitrator',
      aggregateId: profile.id,
      action: 'arbitrator.suspended',
      details: { arbitratorUserId, reason },
    });
    return saved;
  }

  /**
   * Восстановить арбитра (Admin only)
   */
  async reactivateArbitrator(adminId: string, arbitratorUserId: string): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    if (profile.status !== ArbitratorStatus.SUSPENDED) {
      throw new BadRequestException('Arbitrator is not suspended');
    }

    profile.reactivate();
    profile.updatedAt = new Date();

    const saved = await this.profileRepository.save(profile);
    await this.auditLog.write({
      actorId: adminId,
      actorRole: 'admin',
      aggregateType: 'arbitrator',
      aggregateId: profile.id,
      action: 'arbitrator.reactivated',
      details: { arbitratorUserId },
    });
    return saved;
  }

  /**
   * Получить доступных арбитров для назначения
   */
  async getAvailableArbitrators(limit: number = 10): Promise<ArbitratorProfile[]> {
    return this.profileRepository.find({
      where: { status: ArbitratorStatus.ACTIVE },
      relations: ['user'],
      order: { rating: 'DESC', totalCases: 'ASC' }, // Сначала лучшие с меньшей загрузкой
      take: limit,
    });
  }

  /**
   * Назначить арбитра на спор (auto или manual)
   */
  async assignArbitrator(arbitratorUserId: string, disputeId: string): Promise<void> {
    const profile = await this.getProfile(arbitratorUserId);

    if (!profile.canAcceptCases) {
      throw new ForbiddenException('Arbitrator cannot accept cases');
    }

    // Здесь будет логика назначения на спор
    // Обновление lastActiveAt
    profile.lastActiveAt = new Date();
    await this.profileRepository.save(profile);
  }

  /**
   * Завершить дело арбитра
   */
  async completeCase(arbitratorUserId: string, earned: number): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    profile.addCase(earned);
    profile.completeCase();
    profile.updatedAt = new Date();

    return this.profileRepository.save(profile);
  }

  /**
   * Добавить апелляцию к делу арбитра
   */
  async addAppeal(arbitratorUserId: string): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    profile.addAppeal();
    profile.updatedAt = new Date();

    return this.profileRepository.save(profile);
  }

  /**
   * Добавить отменённое решение
   */
  async addOverturn(arbitratorUserId: string): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    profile.addOverturn();
    profile.updatedAt = new Date();

    return this.profileRepository.save(profile);
  }

  /**
   * Обновить рейтинг арбитра
   */
  async updateRating(arbitratorUserId: string, rating: number): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    profile.updateRating(rating);
    profile.updatedAt = new Date();

    return this.profileRepository.save(profile);
  }

  /**
   * Self-service переключение доступности арбитра (AVAILABLE ↔ AWAY).
   *
   * Не задевает admin-managed `status`. Меняется только если профиль
   * утверждён (status === ACTIVE) — иначе бессмысленно: PENDING/SUSPENDED
   * арбитров и так нельзя назначать.
   *
   * Эмитит outbox-событие `arbitrator.availability_changed` для будущих
   * нотификаций (например, оповестить админа когда арбитр уходит «в
   * отпуск» а в очереди есть споры).
   */
  async setAvailability(
    arbitratorUserId: string,
    availability: ArbitratorAvailability,
  ): Promise<ArbitratorProfile> {
    const profile = await this.getProfile(arbitratorUserId);

    if (profile.status !== ArbitratorStatus.ACTIVE) {
      throw new ForbiddenException(
        'Only approved (ACTIVE) arbitrators can change availability',
      );
    }

    if (profile.availability === availability) {
      return profile;
    }

    const previous = profile.availability;
    profile.availability = availability;
    profile.updatedAt = new Date();

    const saved = await this.profileRepository.save(profile);

    await this.outbox.enqueue({
      aggregateType: 'arbitrator',
      aggregateId: profile.id,
      eventType: 'arbitrator.availability_changed',
      payload: {
        arbitratorUserId,
        previous,
        next: availability,
      },
    });

    return saved;
  }

  /**
   * Получить статистику арбитра
   */
  async getStatistics(arbitratorUserId: string): Promise<{
    totalCases: number;
    completedCases: number;
    appealedCases: number;
    overturnedCases: number;
    successRate: number;
    overturnRate: number;
    averageRating: number;
    totalEarned: number;
  }> {
    const profile = await this.getProfile(arbitratorUserId);

    return {
      totalCases: profile.totalCases,
      completedCases: profile.completedCases,
      appealedCases: profile.appealedCases,
      overturnedCases: profile.overturnedCases,
      successRate: profile.successRate,
      overturnRate: profile.overturnRate,
      averageRating: profile.rating,
      totalEarned: profile.totalEarned,
    };
  }

  /**
   * Получить всех арбитров (Admin only)
   */
  async getAllArbitrators(status?: ArbitratorStatus): Promise<ArbitratorProfile[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    return this.profileRepository.find({
      where,
      relations: ['user'],
      order: { rating: 'DESC' },
    });
  }

  async getAllPerformance(): Promise<any[]> {
    const arbitrators = await this.profileRepository.find({
      relations: ['user'],
      order: { rating: 'DESC' },
    });
    return arbitrators.map((arb) => ({
      id: arb.id,
      userId: arb.userId,
      username: arb.user?.telegramUsername,
      status: arb.status,
      rating: arb.rating,
      totalCases: arb.totalCases,
      appealedCases: arb.appealedCases,
      overturnedCases: arb.overturnedCases,
      averageRating: arb.rating,
      totalEarned: arb.totalEarned,
    }));
  }
}
