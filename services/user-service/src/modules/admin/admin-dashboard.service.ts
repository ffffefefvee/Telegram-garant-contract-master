import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { Deal } from '../deal/entities/deal.entity';
import { Payment } from '../payment/entities/payment.entity';
import { Dispute } from '../arbitration/entities/dispute.entity';

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Deal)
    private dealRepo: Repository<Deal>,
    @InjectRepository(Payment)
    private paymentRepo: Repository<Payment>,
    @InjectRepository(Dispute)
    private disputeRepo: Repository<Dispute>,
  ) {}

  /**
   * Получить полную статистику для дашборда
   */
  async getFullStats(): Promise<any> {
    const [
      totalUsers,
      activeUsers,
      totalDeals,
      activeDeals,
      completedDeals,
      totalPayments,
      totalVolume,
      totalDisputes,
      openDisputes,
    ] = await Promise.all([
      this.userRepo.count(),
      this.userRepo.count({ where: { status: 'active' as any } }),
      this.dealRepo.count(),
      this.dealRepo.count({ where: { status: 'ACTIVE' as any } }),
      this.dealRepo.count({ where: { status: 'COMPLETED' as any } }),
      this.paymentRepo.count(),
      this.paymentRepo
        .createQueryBuilder('p')
        .select('SUM(p.amount)', 'total')
        .where('p.status = :status', { status: 'completed' })
        .getRawOne(),
      this.disputeRepo.count(),
      this.disputeRepo.count({ where: { status: 'opened' as any } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
      },
      deals: {
        total: totalDeals,
        active: activeDeals,
        completed: completedDeals,
        completionRate: totalDeals > 0 ? ((completedDeals / totalDeals) * 100).toFixed(2) : 0,
      },
      finance: {
        totalPayments,
        totalVolume: totalVolume?.total || 0,
      },
      disputes: {
        total: totalDisputes,
        open: openDisputes,
        disputeRate: totalDeals > 0 ? ((totalDisputes / totalDeals) * 100).toFixed(2) : 0,
      },
    };
  }

  /**
   * Статистика за последние 7 дней
   */
  async getLast7DaysStats(): Promise<any> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [newUsers, newDeals, newPayments] = await Promise.all([
      this.userRepo.count({
        where: { createdAt: { gte: sevenDaysAgo } as any },
      }),
      this.dealRepo.count({
        where: { createdAt: { gte: sevenDaysAgo } as any },
      }),
      this.paymentRepo
        .createQueryBuilder('p')
        .select('SUM(p.amount)', 'total')
        .where('p.createdAt >= :date', { date: sevenDaysAgo })
        .getRawOne(),
    ]);

    return {
      newUsers,
      newDeals,
      newVolume: newPayments?.total || 0,
    };
  }

  /**
   * Топ пользователей по объему сделок
   */
  async getTopUsersByVolume(limit: number = 10): Promise<any[]> {
    return this.userRepo
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.telegramUsername',
        'u.completedDeals',
        'u.reputationScore',
        'u.balance',
      ])
      .orderBy('u.completedDeals', 'DESC')
      .limit(limit)
      .getMany();
  }
}
