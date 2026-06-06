import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('currency_rates')
@Index(['fromCurrency', 'toCurrency'])
@Index(['source'])
@Index(['createdAt'])
export class CurrencyRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  fromCurrency: string; // RUB, USD, USDT, etc.

  @Column({ type: 'varchar', length: 10 })
  toCurrency: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  rate: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 1 })
  inverseRate: number;

  @Column({ type: 'varchar', length: 50, default: 'manual' })
  source: string; // manual, cryptomus, coingecko, exchanger

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamp' })
  validAt: Date;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isCurrent(): boolean {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return this.createdAt > oneHourAgo && this.isActive;
  }

  // Методы
  convert(amount: number): number {
    return Math.round(amount * this.rate * 100) / 100;
  }

  convertInverse(amount: number): number {
    return Math.round(amount * this.inverseRate * 100) / 100;
  }

  // Статические методы
  static createRate(
    from: string,
    to: string,
    rate: number,
    source?: string,
  ): Partial<CurrencyRate> {
    return {
      fromCurrency: from,
      toCurrency: to,
      rate,
      inverseRate: 1 / rate,
      source: source || 'manual',
      validAt: new Date(),
    };
  }

  static generateCacheKey(from: string, to: string): string {
    return `rate:${from}:${to}`;
  }
}
