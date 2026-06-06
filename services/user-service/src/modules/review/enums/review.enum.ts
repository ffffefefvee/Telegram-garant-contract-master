/**
 * Типы отзывов
 */
export enum ReviewType {
  /** Отзыв от покупателя о продавце */
  BUYER_TO_SELLER = 'buyer_to_seller',
  
  /** Отзыв от продавца о покупателе */
  SELLER_TO_BUYER = 'seller_to_buyer',
}

/**
 * Статусы отзыва
 */
export enum ReviewStatus {
  /** Черновик */
  DRAFT = 'draft',
  
  /** Опубликован */
  PUBLISHED = 'published',
  
  /** Скрыт модерацией */
  HIDDEN = 'hidden',
  
  /** Удалён автором */
  DELETED = 'deleted',
}

/**
 * События репутации
 */
export enum ReputationEventType {
  /** Получен отзыв */
  REVIEW_RECEIVED = 'review_received',
  
  /** Сделка завершена успешно */
  DEAL_COMPLETED = 'deal_completed',
  
  /** Сделка отменена */
  DEAL_CANCELLED = 'deal_cancelled',
  
  /** Спор открыт */
  DISPUTE_OPENED = 'dispute_opened',
  
  /** Спор решён в пользу пользователя */
  DISPUTE_WON = 'dispute_won',
  
  /** Спор решён против пользователя */
  DISPUTE_LOST = 'dispute_lost',
  
  /** Нарушение правил */
  RULE_VIOLATION = 'rule_violation',
  
  /** Верификация пройдена */
  VERIFICATION_COMPLETED = 'verification_completed',
  
  /** Бонус от системы */
  BONUS = 'bonus',
  
  /** Штраф */
  PENALTY = 'penalty',
}

/**
 * Уровни доверия
 */
export enum TrustLevel {
  /** Новый пользователь (0-20) */
  NEW = 'new',
  
  /** Начинающий (21-40) */
  BEGINNER = 'beginner',
  
  /** Опытный (41-60) */
  EXPERIENCED = 'experienced',
  
  /** Надёжный (61-80) */
  RELIABLE = 'reliable',
  
  /** Проверенный (81-100) */
  VERIFIED = 'verified',
}
