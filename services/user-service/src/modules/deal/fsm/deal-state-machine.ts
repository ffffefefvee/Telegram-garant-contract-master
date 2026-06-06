import { DealStatus, DealEventType } from '../enums/deal.enum';
import { Deal } from '../entities/deal.entity';
import { DealEvent } from '../entities/deal-event.entity';

/**
 * Конечный автомат (FSM) для управления статусами сделок
 * 
 * Диаграмма состояний:
 * 
 * DRAFT ──────────────────────────────────────────┐
 *   │                                              │
 *   ▼                                              │
 * PENDING_ACCEPTANCE ──────────────────────────────┤
 *   │                                               │
 *   ▼                                               │
 * PENDING_PAYMENT ───────┐                         │
 *   │                     │                         │
 *   ▼                     ▼                         │
 * IN_PROGRESS ───────► PENDING_CONFIRMATION         │
 *   │                     │                         │
 *   │                     ▼                         │
 *   │                   COMPLETED ◄─────────────────┘
 *   │                     │
 *   │                     ▼
 *   │                 DISPUTED
 *   │                     │
 *   │                     ▼
 *   │              DISPUTE_RESOLVED
 *   │                     │
 *   └─────────────────────┘
 *         │
 *         ▼
 *    CANCELLED / REFUNDED
 */

export interface StateTransition {
  from: DealStatus;
  to: DealStatus;
  event: DealEventType;
  guard?: (deal: Deal) => boolean;
  action?: (deal: Deal) => Promise<void> | void;
}

export interface DealStateMachineConfig {
  commissionRate?: number;
  autoConfirmDays?: number;
  disputePeriodDays?: number;
}

export class DealStateMachine {
  private static readonly transitions: StateTransition[] = [
    // Из черновика
    {
      from: DealStatus.DRAFT,
      to: DealStatus.PENDING_ACCEPTANCE,
      event: DealEventType.DEAL_CREATED,
      guard: (deal) => !!deal.sellerId,
    },
    {
      from: DealStatus.DRAFT,
      to: DealStatus.CANCELLED,
      event: DealEventType.DEAL_CANCELLED,
    },

    // Ожидание принятия
    {
      from: DealStatus.PENDING_ACCEPTANCE,
      to: DealStatus.PENDING_PAYMENT,
      event: DealEventType.COUNTERPARTY_ACCEPTED,
      action: async (deal) => {
        deal.acceptedAt = new Date();
      },
    },
    {
      from: DealStatus.PENDING_ACCEPTANCE,
      to: DealStatus.CANCELLED,
      event: DealEventType.COUNTERPARTY_REJECTED,
    },
    {
      from: DealStatus.PENDING_ACCEPTANCE,
      to: DealStatus.CANCELLED,
      event: DealEventType.DEAL_CANCELLED,
    },

    // Ожидание оплаты
    {
      from: DealStatus.PENDING_PAYMENT,
      to: DealStatus.IN_PROGRESS,
      event: DealEventType.PAYMENT_RECEIVED,
      action: async (deal) => {
        deal.paidAt = new Date();
      },
    },
    {
      from: DealStatus.PENDING_PAYMENT,
      to: DealStatus.CANCELLED,
      event: DealEventType.DEAL_CANCELLED,
      guard: (deal) => !deal.paidAt,
    },
    {
      from: DealStatus.PENDING_PAYMENT,
      to: DealStatus.REFUNDED,
      event: DealEventType.DEAL_REFUNDED,
    },

    // В процессе
    {
      from: DealStatus.IN_PROGRESS,
      to: DealStatus.PENDING_CONFIRMATION,
      event: DealEventType.SELLER_STARTED,
    },
    {
      from: DealStatus.IN_PROGRESS,
      to: DealStatus.DISPUTED,
      event: DealEventType.DISPUTE_OPENED,
      action: async (deal) => {
        deal.disputedAt = new Date();
      },
    },
    {
      from: DealStatus.IN_PROGRESS,
      to: DealStatus.FROZEN,
      event: DealEventType.DISPUTE_OPENED,
      guard: (deal) => !!deal.arbitratorId,
    },

    // Ожидание подтверждения
    {
      from: DealStatus.PENDING_CONFIRMATION,
      to: DealStatus.COMPLETED,
      event: DealEventType.BUYER_CONFIRMED,
      action: async (deal) => {
        deal.completedAt = new Date();
      },
    },
    {
      from: DealStatus.PENDING_CONFIRMATION,
      to: DealStatus.DISPUTED,
      event: DealEventType.DISPUTE_OPENED,
      action: async (deal) => {
        deal.disputedAt = new Date();
      },
    },
    {
      from: DealStatus.PENDING_CONFIRMATION,
      to: DealStatus.REFUNDED,
      event: DealEventType.BUYER_REJECTED,
    },

    // Спор
    {
      from: DealStatus.DISPUTED,
      to: DealStatus.DISPUTE_RESOLVED,
      event: DealEventType.DISPUTE_RESOLVED,
    },
    {
      from: DealStatus.DISPUTED,
      to: DealStatus.FROZEN,
      event: DealEventType.DISPUTE_OPENED,
      guard: (deal) => !!deal.arbitratorId,
    },

    // Спор решён — арбитр вынес решение
    {
      from: DealStatus.DISPUTE_RESOLVED,
      to: DealStatus.COMPLETED,
      event: DealEventType.DISPUTE_DECIDED_SELLER,
      action: async (deal) => {
        deal.completedAt = new Date();
      },
    },
    {
      from: DealStatus.DISPUTE_RESOLVED,
      to: DealStatus.REFUNDED,
      event: DealEventType.DISPUTE_DECIDED_BUYER,
    },

    // Заморожена
    {
      from: DealStatus.FROZEN,
      to: DealStatus.IN_PROGRESS,
      event: DealEventType.DEAL_UNFROZEN,
    },
    {
      from: DealStatus.FROZEN,
      to: DealStatus.REFUNDED,
      event: DealEventType.DEAL_REFUNDED,
    },

    // Таймаут оплаты — авто-отмена
    {
      from: DealStatus.PENDING_PAYMENT,
      to: DealStatus.CANCELLED,
      event: DealEventType.PAYMENT_EXPIRED,
      guard: (deal) => !deal.paidAt,
      action: async (deal) => {
        deal.cancelledAt = new Date();
        deal.cancelReason = 'Payment timeout';
      },
    },

    // Авто-подтверждение покупателем по истечении срока
    {
      from: DealStatus.PENDING_CONFIRMATION,
      to: DealStatus.COMPLETED,
      event: DealEventType.AUTO_CONFIRMED,
      action: async (deal) => {
        deal.completedAt = new Date();
      },
    },
  ];

  constructor(private config: DealStateMachineConfig = {}) {}

  /**
   * Проверка возможности перехода
   */
  canTransition(deal: Deal, toStatus: DealStatus): boolean {
    const transition = DealStateMachine.transitions.find(
      (t) => t.from === deal.status && t.to === toStatus,
    );

    if (!transition) {
      return false;
    }

    if (transition.guard && !transition.guard(deal)) {
      return false;
    }

    return true;
  }

  /**
   * Выполнение перехода
   */
  async transition(
    deal: Deal,
    toStatus: DealStatus,
    userId?: string,
  ): Promise<Deal> {
    const transition = DealStateMachine.transitions.find(
      (t) => t.from === deal.status && t.to === toStatus,
    );

    if (!transition) {
      throw new Error(
        `Invalid transition from ${deal.status} to ${toStatus}`,
      );
    }

    if (transition.guard && !transition.guard(deal)) {
      throw new Error('Transition guard failed');
    }

    // Выполняем действие перехода
    if (transition.action) {
      await transition.action(deal);
    }

    // Обновляем статус
    deal.status = toStatus;
    deal.updatedAt = new Date();

    // NB: we deliberately do NOT push a synthetic event into
    // `deal.events` here. The deal is saved with `cascade: true`, and
    // mutating the in-memory events array — while the relation is not
    // loaded from the DB — makes TypeORM think every existing event row
    // should be detached from the deal (UPDATE deal_id = NULL), which
    // fails since `deal_id` is NOT NULL. Service callers persist
    // transition events via `eventRepository.save(...)` directly.
    void this.createEvent(deal, transition, userId);

    return deal;
  }

  /**
   * Получить доступные переходы
   */
  getAvailableTransitions(deal: Deal): DealStatus[] {
    return DealStateMachine.transitions
      .filter(
        (t) =>
          t.from === deal.status && (!t.guard || t.guard(deal)),
      )
      .map((t) => t.to);
  }

  /**
   * Создать событие для перехода
   */
  private createEvent(
    deal: Deal,
    transition: StateTransition,
    userId?: string,
  ): Partial<DealEvent> {
    // Build a partial entity — leave `id` undefined so TypeORM/Postgres
    // generate the UUID. Setting `id: ''` would make the cascade save
    // attempt a SELECT … WHERE id IN ('') which Postgres rejects with
    // "invalid input syntax for type uuid".
    return {
      type: transition.event,
      dealId: deal.id,
      userId: userId ?? null,
      description: '',
      metadata: {},
      createdAt: new Date(),
    };
  }

  /**
   * Статические методы для быстрой проверки
   */
  static isFinalStatus(status: DealStatus): boolean {
    return [
      DealStatus.COMPLETED,
      DealStatus.CANCELLED,
      DealStatus.REFUNDED,
    ].includes(status);
  }

  static isActiveStatus(status: DealStatus): boolean {
    return ![
      DealStatus.COMPLETED,
      DealStatus.CANCELLED,
      DealStatus.REFUNDED,
    ].includes(status);
  }

  static isPaymentRequired(status: DealStatus): boolean {
    return status === DealStatus.PENDING_PAYMENT;
  }

  static isAwaitingSeller(status: DealStatus): boolean {
    return status === DealStatus.IN_PROGRESS;
  }

  static isAwaitingBuyer(status: DealStatus): boolean {
    return [
      DealStatus.PENDING_PAYMENT,
      DealStatus.PENDING_CONFIRMATION,
    ].includes(status);
  }

  static isDisputed(status: DealStatus): boolean {
    return [
      DealStatus.DISPUTED,
      DealStatus.DISPUTE_RESOLVED,
      DealStatus.FROZEN,
    ].includes(status);
  }
}
