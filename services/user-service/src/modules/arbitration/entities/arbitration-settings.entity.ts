import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Настройки арбитражной системы
 * Управляются через админ-панель Super Admin
 */
@Entity('arbitration_settings')
@Index(['key'], { unique: true })
export class ArbitrationSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'varchar', length: 50 })
  valueType: 'number' | 'string' | 'boolean' | 'json' | 'percent';

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  // Геттеры
  get parsedValue(): number | string | boolean | object {
    switch (this.valueType) {
      case 'number':
        return parseFloat(this.value);
      case 'boolean':
        return this.value === 'true';
      case 'json':
        try {
          return JSON.parse(this.value);
        } catch {
          return {};
        }
      case 'percent':
        return parseFloat(this.value) / 100;
      default:
        return this.value;
    }
  }

  // Статические методы для удобного доступа к настройкам
  static getDefaultSettings(): Array<Partial<ArbitrationSettings>> {
    return [
      // Требования к арбитрам
      {
        key: 'arbitrator_min_reputation',
        value: '500',
        description: 'Минимальная репутация для арбитра',
        valueType: 'number',
      },
      {
        key: 'arbitrator_min_deals',
        value: '20',
        description: 'Минимальное количество завершённых сделок для арбитра',
        valueType: 'number',
      },
      {
        key: 'arbitrator_min_trust_level',
        value: '3',
        description: 'Минимальный уровень доверия (1-New, 2-Basic, 3-Verified, 4-Experienced, 5-Expert)',
        valueType: 'number',
      },
      {
        key: 'arbitrator_deposit_amount',
        value: '100',
        description: 'Залог для арбитра (в USDT эквиваленте)',
        valueType: 'number',
      },
      {
        key: 'arbitrator_verification_required',
        value: 'true',
        description: 'Требуется ли верификация для арбитра',
        valueType: 'boolean',
      },

      // Временные рамки
      {
        key: 'dispute_study_period_hours',
        value: '24',
        description: 'Срок проверки товара по умолчанию (часы)',
        valueType: 'number',
      },
      {
        key: 'dispute_window_hours',
        value: '72',
        description: 'Окно для открытия спора после получения товара (часы)',
        valueType: 'number',
      },
      {
        key: 'arbitrator_assignment_timeout_hours',
        value: '24',
        description: 'Время на назначение арбитра (часы)',
        valueType: 'number',
      },
      {
        key: 'evidence_submission_hours',
        value: '48',
        description: 'Время на предоставление доказательств (часы)',
        valueType: 'number',
      },
      {
        key: 'decision_deadline_hours',
        value: '24',
        description: 'Время на вынесение решения (часы)',
        valueType: 'number',
      },
      {
        key: 'appeal_window_hours',
        value: '24',
        description: 'Окно для апелляции (часы)',
        valueType: 'number',
      },

      // Компенсации и штрафы
      {
        key: 'penalty_percent',
        value: '10',
        description: 'Процент штрафа с нарушителя',
        valueType: 'percent',
      },
      {
        key: 'arbitrator_fee_percent',
        value: '70',
        description: 'Процент штрафа арбитру от общего штрафа',
        valueType: 'percent',
      },
      {
        key: 'platform_fee_percent',
        value: '30',
        description: 'Процент штрафа платформе от общего штрафа',
        valueType: 'percent',
      },
      {
        key: 'seller_success_fee_percent',
        value: '0',
        description: 'Комиссия для честного продавца (0% = нет комиссии)',
        valueType: 'percent',
      },

      // Апелляции
      {
        key: 'appeal_deposit_amount',
        value: '50',
        description: 'Залог апелляции (в USDT эквиваленте)',
        valueType: 'number',
      },
      {
        key: 'appeal_deposit_refund_on_success',
        value: 'true',
        description: 'Возвращать ли залог при успешной апелляции',
        valueType: 'boolean',
      },
      {
        key: 'max_appeals_per_user_per_day',
        value: '3',
        description: 'Максимум апелляций от пользователя в день',
        valueType: 'number',
      },

      // Ограничения
      {
        key: 'max_evidence_file_size_mb',
        value: '10',
        description: 'Максимальный размер файла доказательств (MB)',
        valueType: 'number',
      },
      {
        key: 'allowed_file_types',
        value: '["image/jpeg","image/png","image/gif","video/mp4","application/pdf","text/plain"]',
        description: 'Разрешённые MIME типы файлов',
        valueType: 'json',
      },
      {
        key: 'max_evidence_per_dispute',
        value: '20',
        description: 'Максимум доказательств на спор',
        valueType: 'number',
      },

      // Автоматизация
      {
        key: 'auto_assign_arbitrator_enabled',
        value: 'true',
        description: 'Автоматически назначать арбитра если стороны не выбрали',
        valueType: 'boolean',
      },
      {
        key: 'auto_close_dispute_after_days',
        value: '30',
        description: 'Автоматически закрывать споры через N дней без активности',
        valueType: 'number',
      },
    ];
  }

  // Методы
  updateValue(newValue: string, userId?: string): void {
    this.value = newValue;
    this.updatedAt = new Date();
    if (userId) {
      this.updatedBy = userId;
    }
  }
}
