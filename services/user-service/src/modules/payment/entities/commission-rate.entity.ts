import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('commission_rates')
@Index(['isActive'])
export class CommissionRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  type: string; // deal_payment, deposit, withdraw, etc.

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  rate: number; // 5.00 = 5%

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  minAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  maxAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  fixedFee: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'timestamp', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  validTo: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  // Геттеры
  get isCurrentlyValid(): boolean {
    const now = new Date();
    
    if (this.validFrom && now < this.validFrom) {
      return false;
    }
    
    if (this.validTo && now > this.validTo) {
      return false;
    }
    
    return this.isActive;
  }

  // Методы
  calculateFee(amount: number): number {
    if (!this.isCurrentlyValid) {
      return 0;
    }

    if (amount < this.minAmount || (this.maxAmount > 0 && amount > this.maxAmount)) {
      return 0;
    }

    const percentageFee = (amount * this.rate) / 100;
    return Math.round((percentageFee + this.fixedFee) * 100) / 100;
  }

  // Статические методы
  static getDefaultRates(): { type: string; rate: number; description: string }[] {
    return [
      {
        type: 'deal_payment',
        rate: 5.0,
        description: 'Комиссия за гарантийную сделку (покупатель платит)',
      },
      {
        type: 'deposit',
        rate: 0.0,
        description: 'Пополнение баланса (без комиссии)',
      },
      {
        type: 'withdraw',
        rate: 1.0,
        description: 'Вывод средств',
      },
      {
        type: 'arbitration',
        rate: 10.0,
        description: 'Арбитражный сбор (от суммы сделки)',
      },
    ];
  }
}
