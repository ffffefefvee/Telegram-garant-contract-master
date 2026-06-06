/**
 * Типы сделок в системе гарантийных платежей.
 * MVP поддерживает только DIGITAL; остальные — Phase 2+.
 */
export enum DealType {
  /** Физические товары — Phase 2+ */
  PHYSICAL = 'physical',

  /** Цифровые товары (ключи, аккаунты, файлы) — единственный поддерживаемый тип в MVP */
  DIGITAL = 'digital',

  /** Услуги — Phase 2+ */
  SERVICE = 'service',

  /** Аренда — Phase 2+ */
  RENT = 'rent',
}

/**
 * Подкатегории цифровых товаров (D3, MVP).
 */
export enum DealSubcategory {
  ACCOUNT = 'account',
  KEY_CODE = 'key_code',
  FILE = 'file',
  ONLINE_SERVICE = 'online_service',
  SUBSCRIPTION_TRANSFER = 'subscription_transfer',
}

/**
 * Модель распределения комиссии между сторонами (D4).
 */
export enum FeeModel {
  /** Комиссия делится 50/50 между покупателем и продавцом */
  SPLIT_50_50 = 'split_50_50',
  /** Покупатель платит всю комиссию */
  BUYER_PAYS = 'buyer_pays',
  /** Продавец платит всю комиссию */
  SELLER_PAYS = 'seller_pays',
}

/**
 * Статусы сделки в течение жизненного цикла
 */
export enum DealStatus {
  /** Черновик - сделка создаётся */
  DRAFT = 'draft',
  
  /** Ожидание принятия контрагентом */
  PENDING_ACCEPTANCE = 'pending_acceptance',
  
  /** Ожидание оплаты от покупателя */
  PENDING_PAYMENT = 'pending_payment',
  
  /** Оплата в эскроу, ожидание выполнения */
  IN_PROGRESS = 'in_progress',
  
  /** Ожидание подтверждения получения */
  PENDING_CONFIRMATION = 'pending_confirmation',
  
  /** Сделка успешно завершена */
  COMPLETED = 'completed',
  
  /** Сделка отменена (до оплаты) */
  CANCELLED = 'cancelled',
  
  /** Сделка возвращена (после оплаты) */
  REFUNDED = 'refunded',
  
  /** Открыт спор */
  DISPUTED = 'disputed',
  
  /** Спор решён */
  DISPUTE_RESOLVED = 'dispute_resolved',
  
  /** Сделка заморожена арбитром */
  FROZEN = 'frozen',
}

/**
 * Стороны сделки
 */
export enum DealSide {
  /** Покупатель - платит деньги */
  BUYER = 'buyer',
  
  /** Продавец - получает деньги */
  SELLER = 'seller',
}

/**
 * Типы вложений к сообщениям сделки
 */
export enum AttachmentType {
  /** Изображение */
  IMAGE = 'image',
  
  /** Документ */
  DOCUMENT = 'document',
  
  /** Видео */
  VIDEO = 'video',
  
  /** Аудио */
  AUDIO = 'audio',
  
  /** Ссылка */
  LINK = 'link',
  
  /** Голосовое сообщение */
  VOICE = 'voice',
}

/**
 * Типы событий в сделке
 */
export enum DealEventType {
  /** Сделка создана */
  DEAL_CREATED = 'deal_created',
  
  /** Контрагент приглашён */
  COUNTERPARTY_INVITED = 'counterparty_invited',
  
  /** Контрагент принял сделку */
  COUNTERPARTY_ACCEPTED = 'counterparty_accepted',
  
  /** Контрагент отклонил сделку */
  COUNTERPARTY_REJECTED = 'counterparty_rejected',
  
  /** Оплата внесена */
  PAYMENT_RECEIVED = 'payment_received',
  
  /** Продавец начал выполнение */
  SELLER_STARTED = 'seller_started',
  
  /** Покупатель подтвердил получение */
  BUYER_CONFIRMED = 'buyer_confirmed',
  
  /** Покупатель отклонил получение */
  BUYER_REJECTED = 'buyer_rejected',
  
  /** Открыт спор */
  DISPUTE_OPENED = 'dispute_opened',

  /** Спор решён */
  DISPUTE_RESOLVED = 'dispute_resolved',

  /** Арбитр вынес решение в пользу продавца (после спора) */
  DISPUTE_DECIDED_SELLER = 'dispute_decided_seller',

  /** Арбитр вынес решение в пользу покупателя (после спора) */
  DISPUTE_DECIDED_BUYER = 'dispute_decided_buyer',

  /** Замороженная сделка разморожена и продолжена */
  DEAL_UNFROZEN = 'deal_unfrozen',

  /** Сделка отменена */
  DEAL_CANCELLED = 'deal_cancelled',

  /** Сделка возвращена */
  DEAL_REFUNDED = 'deal_refunded',

  /** Платёж истёк (таймаут) — автоматическая отмена */
  PAYMENT_EXPIRED = 'payment_expired',

  /** Автоподтверждение покупателем по истечении дедлайна */
  AUTO_CONFIRMED = 'auto_confirmed',

  /** Сообщение отправлено */
  MESSAGE_SENT = 'message_sent',

  /** Вложение добавлено */
  ATTACHMENT_ADDED = 'attachment_added',
}

/**
 * Валюты для сделок
 */
export enum Currency {
  RUB = 'RUB',
  USD = 'USD',
  EUR = 'EUR',
  TON = 'TON',
  USDT = 'USDT',
  BTC = 'BTC',
}
