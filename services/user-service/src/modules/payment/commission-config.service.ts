import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommissionRate } from './entities/commission-rate.entity';
import { FeeModel } from '../deal/enums/deal.enum';
import { computeDealFeeRub, D5_PERCENT_RATE } from './fee-model';

@Injectable()
export class CommissionConfigService {
  private static readonly DEFAULT_RATE = D5_PERCENT_RATE;

  constructor(
    @InjectRepository(CommissionRate)
    private readonly commissionRepo: Repository<CommissionRate>,
  ) {}

  /**
   * D5 tariff grid:
   *   amount < 1000 RUB  → fixed 50 RUB
   *   amount >= 1000 RUB → 5 % of amount
   *
   * If the DB contains active `deal_payment` rows they override the hard-coded
   * defaults (the DB rows must have `fixedFee` set for the < 1000 tier).
   */
  async calculateDealFeeRub(amountRub: number): Promise<number> {
    const rows = await this.commissionRepo.find({
      where: { type: 'deal_payment', isActive: true },
      order: { minAmount: 'ASC' },
    });

    for (const row of rows) {
      if (!row.isCurrentlyValid) continue;
      const min = Number(row.minAmount) || 0;
      const max = Number(row.maxAmount) || 0;
      if (amountRub >= min && (max <= 0 || amountRub <= max)) {
        return row.calculateFee(amountRub);
      }
    }

    // D5 canonical fallback (single source of truth in fee-model.ts)
    return computeDealFeeRub(amountRub);
  }

  /**
   * Legacy alias kept for backward compatibility.
   * @deprecated Use calculateDealFeeRub for new code.
   */
  async calculateDealFee(amount: number): Promise<number> {
    return this.calculateDealFeeRub(amount);
  }

  /**
   * Split a total fee between buyer and seller according to feeModel (D4).
   */
  splitFee(
    totalFee: number,
    model: FeeModel = FeeModel.BUYER_PAYS,
  ): { buyerFee: number; sellerFee: number } {
    switch (model) {
      case FeeModel.BUYER_PAYS:
        return { buyerFee: totalFee, sellerFee: 0 };
      case FeeModel.SELLER_PAYS:
        return { buyerFee: 0, sellerFee: totalFee };
      case FeeModel.SPLIT_50_50: {
        const half = Math.round((totalFee / 2) * 100) / 100;
        return { buyerFee: half, sellerFee: totalFee - half };
      }
    }
  }

  /**
   * Returns commission rate as decimal (e.g. 0.05 for 5%).
   * @deprecated Use calculateDealFeeRub which implements the full D5 grid.
   */
  async getDealPaymentRate(amount: number): Promise<number> {
    const rows = await this.commissionRepo.find({
      where: { type: 'deal_payment', isActive: true },
      order: { minAmount: 'ASC' },
    });

    for (const row of rows) {
      if (!row.isCurrentlyValid) continue;
      const min = Number(row.minAmount) || 0;
      const max = Number(row.maxAmount) || 0;
      if (amount >= min && (max <= 0 || amount <= max)) {
        return Number(row.rate) / 100;
      }
    }

    return CommissionConfigService.DEFAULT_RATE;
  }
}
