/**
 * Статусы спора (FSM)
 */
export enum DisputeStatus {
  /** Спор открыт */
  OPENED = 'opened',
  
  /** Ждём ответ продавца */
  WAITING_SELLER_RESPONSE = 'waiting_seller_response',
  
  /** Ждём доказательства покупателя */
  WAITING_BUYER_EVIDENCE = 'waiting_buyer_evidence',
  
  /** Ждём доказательства продавца */
  WAITING_SELLER_EVIDENCE = 'waiting_seller_evidence',
  
  /** Ждём назначения арбитра */
  PENDING_ARBITRATOR = 'pending_arbitrator',
  
  /** Арбитр изучает дело */
  UNDER_REVIEW = 'under_review',
  
  /** Решение вынесено */
  DECISION_MADE = 'decision_made',
  
  /** Ждём апелляцию (период ожидания) */
  APPEAL_PERIOD = 'appeal_period',
  
  /** Подана апелляция */
  APPEALED = 'appealed',
  
  /** Решение исполнено */
  ENFORCED = 'enforced',
  
  /** Спор закрыт */
  CLOSED = 'closed',
}

/**
 * Типы споров
 */
export enum DisputeType {
  /** Товар не соответствует описанию */
  PRODUCT_MISMATCH = 'product_mismatch',
  
  /** Товар не получен */
  NOT_RECEIVED = 'not_received',
  
  /** Товар не работает */
  NOT_WORKING = 'not_working',
  
  /** Продавец не отвечает */
  SELLER_NO_RESPONSE = 'seller_no_response',
  
  /** Покупатель не подтверждает */
  BUYER_NO_CONFIRM = 'buyer_no_confirm',
  
  /** Возврат средств */
  REFUND_REQUEST = 'refund_request',
  
  /** Мошенничество */
  FRAUD = 'fraud',
  
  /** Другое */
  OTHER = 'other',
}

/**
 * Сторона, открывшая спор
 */
export enum DisputeSide {
  BUYER = 'buyer',
  SELLER = 'seller',
}

/**
 * Тип решения арбитра
 */
export enum ArbitrationDecisionType {
  /** В пользу покупателя (полный возврат) */
  FULL_REFUND_TO_BUYER = 'full_refund_to_buyer',
  
  /** В пользу покупателя (частичный возврат) */
  PARTIAL_REFUND_TO_BUYER = 'partial_refund_to_buyer',
  
  /** В пользу продавца (полная оплата) */
  FULL_PAYMENT_TO_SELLER = 'full_payment_to_seller',
  
  /** В пользу продавца (частичная оплата) */
  PARTIAL_PAYMENT_TO_SELLER = 'partial_payment_to_seller',
  
  /** Раздел средств */
  SPLIT_FUNDS = 'split_funds',
  
  /** Возврат без штрафа */
  REFUND_NO_PENALTY = 'refund_no_penalty',
}

/**
 * Типы доказательств
 */
export enum EvidenceType {
  /** Скриншот */
  SCREENSHOT = 'screenshot',
  
  /** Видео */
  VIDEO = 'video',
  
  /** Файл */
  FILE = 'file',
  
  /** Ссылка */
  LINK = 'link',
  
  /** Текст (объяснение) */
  TEXT = 'text',
  
  /** Аудио */
  AUDIO = 'audio',
}

/**
 * Статус арбитража
 */
export enum ArbitratorStatus {
  /** Активен */
  ACTIVE = 'active',
  
  /** На рассмотрении */
  PENDING = 'pending',
  
  /** Приостановлен */
  SUSPENDED = 'suspended',
  
  /** Отклонён */
  REJECTED = 'rejected',
}

/**
 * Self-service work-state. Independent of {@link ArbitratorStatus} so an
 * approved arbitrator can mark themselves AWAY without affecting their
 * admin-managed lifecycle.
 */
export enum ArbitratorAvailability {
  /** Принимает дела */
  AVAILABLE = 'available',

  /** В отъезде / занят */
  AWAY = 'away',
}

/**
 * Типы событий в арбитраже
 */
export enum ArbitrationEventType {
  /** Спор открыт */
  DISPUTE_OPENED = 'dispute_opened',
  
  /** Ответ продавца */
  SELLER_RESPONSE = 'seller_response',
  
  /** Доказательство загружено */
  EVIDENCE_SUBMITTED = 'evidence_submitted',
  
  /** Арбитр назначен */
  ARBITRATOR_ASSIGNED = 'arbitrator_assigned',
  
  /** Решение вынесено */
  DECISION_MADE = 'decision_made',
  
  /** Апелляция подана */
  APPEAL_FILED = 'appeal_filed',
  
  /** Решение исполнено */
  DECISION_ENFORCED = 'decision_enforced',
  
  /** Спор закрыт */
  DISPUTE_CLOSED = 'dispute_closed',
  
  /** Штраф наложен */
  PENALTY_APPLIED = 'penalty_applied',
  
  /** Сообщение в чате */
  MESSAGE_SENT = 'message_sent',
}
