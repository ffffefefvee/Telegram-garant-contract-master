import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArbitrationSettings } from './entities/arbitration-settings.entity';

/**
 * Сервис для управления настройками арбитража
 * Все настройки хранятся в БД и изменяются через админ-панель
 */
@Injectable()
export class ArbitrationSettingsService {
  constructor(
    @InjectRepository(ArbitrationSettings)
    private readonly settingsRepository: Repository<ArbitrationSettings>,
  ) {}

  /**
   * Инициализация настроек по умолчанию
   */
  async initializeDefaults(): Promise<void> {
    const defaultSettings = ArbitrationSettings.getDefaultSettings();
    
    for (const setting of defaultSettings) {
      const exists = await this.settingsRepository.findOne({
        where: { key: setting.key },
      });

      if (!exists) {
        await this.settingsRepository.save({
          ...setting,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }
  }

  /**
   * Получить значение настройки по ключу
   */
  async getSetting<T>(key: string): Promise<T> {
    const setting = await this.settingsRepository.findOne({ where: { key } });
    
    if (!setting) {
      throw new NotFoundException(`Setting "${key}" not found`);
    }

    return setting.parsedValue as T;
  }

  /**
   * Получить значение настройки или default
   */
  async getSettingOrDefault<T>(key: string, defaultValue: T): Promise<T> {
    try {
      return await this.getSetting<T>(key);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Обновить значение настройки
   */
  async updateSetting(key: string, value: string, userId?: string): Promise<ArbitrationSettings> {
    const setting = await this.settingsRepository.findOne({ where: { key } });
    
    if (!setting) {
      throw new NotFoundException(`Setting "${key}" not found`);
    }

    setting.updateValue(value, userId);
    return this.settingsRepository.save(setting);
  }

  /**
   * Получить все настройки
   */
  async getAllSettings(): Promise<ArbitrationSettings[]> {
    return this.settingsRepository.find({
      order: { key: 'ASC' },
    });
  }

  /**
   * Получить настройки по категории
   */
  async getSettingsByCategory(category: string): Promise<ArbitrationSettings[]> {
    const settings = await this.getAllSettings();
    
    // Категоризация по префиксу ключа
    return settings.filter(setting => setting.key.startsWith(category));
  }

  /**
   * Получить числовую настройку
   */
  async getNumber(key: string): Promise<number> {
    return this.getSetting<number>(key);
  }

  /**
   * Получить boolean настройку
   */
  async getBoolean(key: string): Promise<boolean> {
    return this.getSetting<boolean>(key);
  }

  /**
   * Получить процент (возвращает 0-1)
   */
  async getPercent(key: string): Promise<number> {
    return this.getSetting<number>(key);
  }

  /**
   * Получить JSON настройку
   */
  async getJson<T>(key: string): Promise<T> {
    return this.getSetting<T>(key);
  }

  // === Convenience методы для часто используемых настроек ===

  // Требования к арбитрам
  async getArbitratorMinReputation(): Promise<number> {
    return this.getNumber('arbitrator_min_reputation');
  }

  async getArbitratorMinDeals(): Promise<number> {
    return this.getNumber('arbitrator_min_deals');
  }

  async getArbitratorMinTrustLevel(): Promise<number> {
    return this.getNumber('arbitrator_min_trust_level');
  }

  async getArbitratorDepositAmount(): Promise<number> {
    return this.getNumber('arbitrator_deposit_amount');
  }

  async isArbitratorVerificationRequired(): Promise<boolean> {
    return this.getBoolean('arbitrator_verification_required');
  }

  // Временные рамки
  async getStudyPeriodHours(): Promise<number> {
    return this.getNumber('dispute_study_period_hours');
  }

  async getDisputeWindowHours(): Promise<number> {
    return this.getNumber('dispute_window_hours');
  }

  async getArbitratorAssignmentTimeoutHours(): Promise<number> {
    return this.getNumber('arbitrator_assignment_timeout_hours');
  }

  async getEvidenceSubmissionHours(): Promise<number> {
    return this.getNumber('evidence_submission_hours');
  }

  async getDecisionDeadlineHours(): Promise<number> {
    return this.getNumber('decision_deadline_hours');
  }

  async getAppealWindowHours(): Promise<number> {
    return this.getNumber('appeal_window_hours');
  }

  // Компенсации и штрафы
  async getPenaltyPercent(): Promise<number> {
    return this.getPercent('penalty_percent');
  }

  async getArbitratorFeePercent(): Promise<number> {
    return this.getPercent('arbitrator_fee_percent');
  }

  async getPlatformFeePercent(): Promise<number> {
    return this.getPercent('platform_fee_percent');
  }

  async getSellerSuccessFeePercent(): Promise<number> {
    return this.getPercent('seller_success_fee_percent');
  }

  // Апелляции
  async getAppealDepositAmount(): Promise<number> {
    return this.getNumber('appeal_deposit_amount');
  }

  async isAppealDepositRefundOnSuccess(): Promise<boolean> {
    return this.getBoolean('appeal_deposit_refund_on_success');
  }

  async getMaxAppealsPerUserPerDay(): Promise<number> {
    return this.getNumber('max_appeals_per_user_per_day');
  }

  // Ограничения
  async getMaxEvidenceFileSizeMb(): Promise<number> {
    return this.getNumber('max_evidence_file_size_mb');
  }

  async getAllowedFileTypes(): Promise<string[]> {
    return this.getJson<string[]>('allowed_file_types');
  }

  async getMaxEvidencePerDispute(): Promise<number> {
    return this.getNumber('max_evidence_per_dispute');
  }

  // Автоматизация
  async isAutoAssignArbitratorEnabled(): Promise<boolean> {
    return this.getBoolean('auto_assign_arbitrator_enabled');
  }

  async getAutoCloseDisputeAfterDays(): Promise<number> {
    return this.getNumber('auto_close_dispute_after_days');
  }
}
