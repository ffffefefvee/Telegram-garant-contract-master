import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReputationScore } from './entities/reputation-score.entity';
import { User } from '../user/entities/user.entity';
import { ReputationEventType, TrustLevel } from './enums/review.enum';

@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(
    @InjectRepository(ReputationScore)
    private reputationRepository: Repository<ReputationScore>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * Добавление изменения репутации
   */
  async addScoreChange(
    userId: string,
    type: ReputationEventType,
    delta: number,
    description?: string,
    reason?: string,
    dealId?: string,
    metadata?: Record<string, any>,
  ): Promise<ReputationScore> {
    // Получение текущего scores
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const currentScore = Math.round(Number(user.reputationScore ?? 0));
    const newScore = Math.max(0, Math.min(100, currentScore + delta));

    // Создание записи
    const scoreChange = this.reputationRepository.create({
      userId,
      dealId: dealId || null,
      type,
      scoreDelta: delta,
      scoreBefore: currentScore,
      scoreAfter: newScore,
      description: description || ReputationService.getEventDefaults()[type]?.description,
      reason,
      metadata: metadata || {},
    });

    const savedScoreChange = await this.reputationRepository.save(scoreChange);

    // Обновление пользователя
    user.reputationScore = newScore;
    await this.userRepository.save(user);

    this.logger.log(
      `Reputation changed for user ${userId}: ${currentScore} → ${newScore} (${delta >= 0 ? '+' : ''}${delta})`,
    );

    return savedScoreChange;
  }

  /**
   * Запись об успешной сделке
   */
  async onDealCompleted(userId: string, dealId: string): Promise<ReputationScore> {
    const defaults = ReputationService.getEventDefaults();
    return this.addScoreChange(
      userId,
      ReputationEventType.DEAL_COMPLETED,
      defaults[ReputationEventType.DEAL_COMPLETED].delta,
      undefined,
      undefined,
      dealId,
    );
  }

  /**
   * Запись об отменённой сделке
   */
  async onDealCancelled(userId: string, dealId: string, reason?: string): Promise<ReputationScore> {
    const defaults = ReputationService.getEventDefaults();
    return this.addScoreChange(
      userId,
      ReputationEventType.DEAL_CANCELLED,
      defaults[ReputationEventType.DEAL_CANCELLED].delta,
      undefined,
      reason,
      dealId,
    );
  }

  /**
   * Запись о споре
   */
  async onDisputeOpened(userId: string, dealId: string): Promise<ReputationScore> {
    const defaults = ReputationService.getEventDefaults();
    return this.addScoreChange(
      userId,
      ReputationEventType.DISPUTE_OPENED,
      defaults[ReputationEventType.DISPUTE_OPENED].delta,
      undefined,
      undefined,
      dealId,
    );
  }

  /**
   * Запись о результате спора
   */
  async onDisputeResolved(
    userId: string,
    dealId: string,
    won: boolean,
  ): Promise<ReputationScore> {
    const defaults = ReputationService.getEventDefaults();
    const eventType = won
      ? ReputationEventType.DISPUTE_WON
      : ReputationEventType.DISPUTE_LOST;

    return this.addScoreChange(
      userId,
      eventType,
      defaults[eventType].delta,
      undefined,
      undefined,
      dealId,
    );
  }

  /**
   * Запись о нарушении
   */
  async onRuleViolation(
    userId: string,
    reason: string,
    metadata?: Record<string, any>,
  ): Promise<ReputationScore> {
    const defaults = ReputationService.getEventDefaults();
    return this.addScoreChange(
      userId,
      ReputationEventType.RULE_VIOLATION,
      defaults[ReputationEventType.RULE_VIOLATION].delta,
      undefined,
      reason,
      undefined,
      metadata,
    );
  }

  /**
   * Запись о верификации
   */
  async onVerificationCompleted(userId: string): Promise<ReputationScore> {
    const defaults = ReputationService.getEventDefaults();
    return this.addScoreChange(
      userId,
      ReputationEventType.VERIFICATION_COMPLETED,
      defaults[ReputationEventType.VERIFICATION_COMPLETED].delta,
    );
  }

  /**
   * Бонус
   */
  async addBonus(userId: string, reason: string, delta: number = 5): Promise<ReputationScore> {
    return this.addScoreChange(
      userId,
      ReputationEventType.BONUS,
      delta,
      'Бонус от системы',
      reason,
    );
  }

  /**
   * Штраф
   */
  async addPenalty(userId: string, reason: string, delta: number = -5): Promise<ReputationScore> {
    return this.addScoreChange(
      userId,
      ReputationEventType.PENALTY,
      delta,
      'Штраф',
      reason,
    );
  }

  /**
   * История репутации пользователя
   */
  async getReputationHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ scores: ReputationScore[]; total: number }> {
    const [scores, total] = await this.reputationRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
      relations: ['deal'],
    });

    return { scores, total };
  }

  /**
   * Определение уровня доверия
   */
  getTrustLevel(score: number): TrustLevel {
    if (score >= 81) return TrustLevel.VERIFIED;
    if (score >= 61) return TrustLevel.RELIABLE;
    if (score >= 41) return TrustLevel.EXPERIENCED;
    if (score >= 21) return TrustLevel.BEGINNER;
    return TrustLevel.NEW;
  }

  /**
   * Получение иконки уровня доверия
   */
  getTrustLevelIcon(level: TrustLevel): string {
    switch (level) {
      case TrustLevel.VERIFIED:
        return '✅';
      case TrustLevel.RELIABLE:
        return '🟢';
      case TrustLevel.EXPERIENCED:
        return '🔵';
      case TrustLevel.BEGINNER:
        return '🟡';
      case TrustLevel.NEW:
        return '⚪';
      default:
        return '⚪';
    }
  }

  /**
   * Проверка доверия для лимитов
   */
  checkTrustRequirements(
    score: number,
    requirements: { minScore?: number; minLevel?: TrustLevel },
  ): boolean {
    const level = this.getTrustLevel(score);

    if (requirements.minScore && score < requirements.minScore) {
      return false;
    }

    if (requirements.minLevel) {
      const levelOrder: Record<TrustLevel, number> = {
        [TrustLevel.NEW]: 0,
        [TrustLevel.BEGINNER]: 1,
        [TrustLevel.EXPERIENCED]: 2,
        [TrustLevel.RELIABLE]: 3,
        [TrustLevel.VERIFIED]: 4,
      };

      if (levelOrder[level] < levelOrder[requirements.minLevel]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Стандартные значения событий
   */
  static getEventDefaults(): Record<
    ReputationEventType,
    { delta: number; description: string }
  > {
    return {
      [ReputationEventType.REVIEW_RECEIVED]: {
        delta: 0,
        description: 'Получен отзыв',
      },
      [ReputationEventType.DEAL_COMPLETED]: {
        delta: 2,
        description: 'Успешно завершённая сделка',
      },
      [ReputationEventType.DEAL_CANCELLED]: {
        delta: -1,
        description: 'Отменённая сделка',
      },
      [ReputationEventType.DISPUTE_OPENED]: {
        delta: -2,
        description: 'Открыт спор',
      },
      [ReputationEventType.DISPUTE_WON]: {
        delta: 5,
        description: 'Спор выигран',
      },
      [ReputationEventType.DISPUTE_LOST]: {
        delta: -5,
        description: 'Спор проигран',
      },
      [ReputationEventType.RULE_VIOLATION]: {
        delta: -10,
        description: 'Нарушение правил',
      },
      [ReputationEventType.VERIFICATION_COMPLETED]: {
        delta: 10,
        description: 'Верификация пройдена',
      },
      [ReputationEventType.BONUS]: {
        delta: 5,
        description: 'Бонус от системы',
      },
      [ReputationEventType.PENALTY]: {
        delta: -5,
        description: 'Штраф',
      },
    };
  }
}
