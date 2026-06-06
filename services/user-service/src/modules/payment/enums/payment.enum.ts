/**
 * Типы платежей в системе
 */
export enum PaymentType {
  /** Пополнение баланса */
  DEPOSIT = 'deposit',
  
  /** Оплата сделки */
  DEAL_PAYMENT = 'deal_payment',
  
  /** Возврат средств */
  REFUND = 'refund',
  
  /** Вывод средств */
  WITHDRAW = 'withdraw',
  
  /** Комиссия системы */
  COMMISSION = 'commission',
  
  /** Арбитражный сбор */
  ARBITRATION_FEE = 'arbitration_fee',
}

/**
 * Статусы платежа
 */
export enum PaymentStatus {
  /** Ожидает оплаты */
  PENDING = 'pending',
  
  /** В обработке */
  PROCESSING = 'processing',
  
  /** Успешно оплачен */
  COMPLETED = 'completed',
  
  /** Не оплачен (истёк срок) */
  EXPIRED = 'expired',
  
  /** Отменён */
  CANCELLED = 'cancelled',
  
  /** Ошибка платежа */
  FAILED = 'failed',
  
  /** Возвращён */
  REFUNDED = 'refunded',
}

/**
 * Методы оплаты
 */
export enum PaymentMethod {
  /** Cryptomus (криптовалюта) */
  CRYPTOMUS = 'cryptomus',
  
  /** Банковская карта */
  CARD = 'card',
  
  /** Электронный кошелёк */
  E_WALLET = 'e_wallet',
  
  /** Криптовалюта (напрямую) */
  CRYPTO = 'crypto',
  
  /** Внутренний баланс */
  BALANCE = 'balance',
}

/**
 * Валюты для конвертации
 */
export enum FiatCurrency {
  RUB = 'RUB',
  USD = 'USD',
  EUR = 'EUR',
  UAH = 'UAH',
  BYN = 'BYN',
  KZT = 'KZT',
}

/**
 * Криптовалюты
 */
export enum CryptoCurrency {
  USDT = 'USDT',
  USDC = 'USDC',
  BTC = 'BTC',
  ETH = 'ETH',
  TON = 'TON',
  TRX = 'TRX',
  LTC = 'LTC',
}

/**
 * Направление конвертации
 */
export enum ConversionDirection {
  /** Фиат в крипту */
  FIAT_TO_CRYPTO = 'fiat_to_crypto',
  
  /** Крипта в фиат */
  CRYPTO_TO_FIAT = 'crypto_to_fiat',
  
  /** Крипта в крипту */
  CRYPTO_TO_CRYPTO = 'crypto_to_crypto',
  
  /** Фиат в фиат */
  FIAT_TO_FIAT = 'fiat_to_fiat',
}
