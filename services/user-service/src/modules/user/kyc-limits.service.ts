import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from './entities/user.entity';
import { Deal } from '../deal/entities/deal.entity';
import { DealStatus } from '../deal/enums/deal.enum';

export interface KycLimits {
  maxDealAmount: number;
  maxDailyVolume: number;
  requiresVerification: boolean;
}

@Injectable()
export class KycLimitsService {
  private static readonly UNVERIFIED_MAX_DEAL = 50_000;
  private static readonly UNVERIFIED_DAILY = 100_000;
  private static readonly VERIFIED_MAX_DEAL = 5_000_000;
  private static readonly VERIFIED_DAILY = 10_000_000;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
  ) {}

  getLimits(user: User): KycLimits {
    const verified =
      user.status === UserStatus.ACTIVE &&
      user.metadata?.kycVerified === true;

    if (verified) {
      return {
        maxDealAmount: KycLimitsService.VERIFIED_MAX_DEAL,
        maxDailyVolume: KycLimitsService.VERIFIED_DAILY,
        requiresVerification: false,
      };
    }

    return {
      maxDealAmount: KycLimitsService.UNVERIFIED_MAX_DEAL,
      maxDailyVolume: KycLimitsService.UNVERIFIED_DAILY,
      requiresVerification: user.status === UserStatus.PENDING_VERIFICATION,
    };
  }

  async assertCanCreateDeal(userId: string, amount: number): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const limits = this.getLimits(user);
    if (amount > limits.maxDealAmount) {
      throw new ForbiddenException(
        `Deal amount exceeds limit (${limits.maxDealAmount}). Complete verification to raise limits.`,
      );
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const raw = await this.dealRepo
      .createQueryBuilder('d')
      .select('COALESCE(SUM(d.amount), 0)', 'sum')
      .where('d.buyer_id = :userId', { userId })
      .andWhere('d.created_at >= :start', { start: startOfDay })
      .andWhere('d.status NOT IN (:...excluded)', {
        excluded: [DealStatus.CANCELLED, DealStatus.REFUNDED],
      })
      .getRawOne<{ sum: string }>();

    const dailyTotal = Number(raw?.sum ?? 0) + amount;
    if (dailyTotal > limits.maxDailyVolume) {
      throw new ForbiddenException(
        `Daily deal volume limit exceeded (${limits.maxDailyVolume}).`,
      );
    }
  }
}
