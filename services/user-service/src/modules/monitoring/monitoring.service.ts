import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, In } from 'typeorm';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  SystemAlert,
  HealthCheck,
  SystemMetrics,
  RecoveryLog,
  JobSchedule,
  AlertSeverity,
  AlertType,
} from './entities/monitoring.entity';
import { DealService } from '../deal/deal.service';
import { PaymentService } from '../payment/payment.service';
import { Deal } from '../deal/entities/deal.entity';
import { DealStatus } from '../deal/enums/deal.enum';
import { Payment } from '../payment/entities/payment.entity';
import { PaymentStatus } from '../payment/enums/payment.enum';
import { OutboxService } from '../ops/outbox.service';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';
import { ConfigService } from '@nestjs/config';
import { TreasuryClient } from '../blockchain/treasury.client';
import { BlockchainProvider } from '../blockchain/blockchain.provider';

@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);
  private isMonitoring = false;

  constructor(
    @InjectRepository(SystemAlert)
    private alertRepository: Repository<SystemAlert>,
    @InjectRepository(HealthCheck)
    private healthRepository: Repository<HealthCheck>,
    @InjectRepository(SystemMetrics)
    private metricsRepository: Repository<SystemMetrics>,
    @InjectRepository(RecoveryLog)
    private recoveryRepository: Repository<RecoveryLog>,
    @InjectRepository(JobSchedule)
    private jobRepository: Repository<JobSchedule>,
    @InjectRedis() private redis: Redis,
    @Inject(forwardRef(() => DealService))
    private dealService: DealService,
    @Inject(forwardRef(() => PaymentService))
    private paymentService: PaymentService,
    @InjectRepository(Deal)
    private dealRepo: Repository<Deal>,
    @InjectRepository(Payment)
    private paymentRepo: Repository<Payment>,
    private readonly outbox: OutboxService,
    @Inject(forwardRef(() => TelegramBotService))
    private readonly telegramBot: TelegramBotService,
    private readonly config: ConfigService,
    private readonly treasury: TreasuryClient,
    private readonly blockchainProvider: BlockchainProvider,
  ) {}

  async onModuleInit() {
    this.logger.log('Monitoring service initialized');
    await this.recordMetric('system.started', 1, 'count');
    this.startMonitoring();
  }

  private startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    setInterval(() => this.healthCheck(), 60000);
    setInterval(() => this.checkStuckDeals(), 300000);
    setInterval(() => this.checkPendingPayments(), 120000);
    setInterval(() => this.checkTreasuryReserve(), 600000);
    setInterval(() => this.cleanupOldAlerts(), 3600000);

    this.logger.log('Background monitoring started');
  }

  async recordMetric(metric: string, value: number, unit = 'unit', service = 'main'): Promise<void> {
    try {
      await this.metricsRepository.save({
        metric,
        value,
        unit,
        service,
        tags: JSON.stringify({}),
      });
    } catch (error) {
      this.logger.error(`Failed to record metric: ${error.message}`);
    }
  }

  async recordDealEvent(event: string, dealId: string, metadata?: Record<string, any>): Promise<void> {
    await this.recordMetric(`deal.${event}`, 1, 'count');

    const redisKey = `deal:${dealId}:events`;
    await this.redis.lpush(redisKey, JSON.stringify({
      event,
      timestamp: Date.now(),
      metadata,
    }));
    await this.redis.ltrim(redisKey, 0, 999);
  }

  async recordPaymentEvent(event: string, paymentId: string, amount?: number): Promise<void> {
    await this.recordMetric(`payment.${event}`, 1, 'count');
    if (amount) {
      await this.recordMetric('payment.volume', amount, 'USD');
    }
  }

  async healthCheck(): Promise<void> {
    const checks = [
      { service: 'database', check: () => this.checkDatabase() },
      { service: 'redis', check: () => this.checkRedis() },
      { service: 'telegram', check: () => this.checkTelegram() },
    ];

    for (const { service, check } of checks) {
      const start = Date.now();
      try {
        await check();
        await this.saveHealthCheck(service, true, Date.now() - start);
      } catch (error) {
        await this.saveHealthCheck(service, false, Date.now() - start, error.message);
      }
    }
  }

  private async checkDatabase(): Promise<void> {
    const result = await this.metricsRepository.query('SELECT 1');
    if (!result) throw new Error('Database check failed');
  }

  private async checkRedis(): Promise<void> {
    const pong = await this.redis.ping();
    if (pong !== 'PONG') throw new Error('Redis check failed');
  }

  private async checkTelegram(): Promise<void> {
    const bot = this.telegramBot.getBot();
    if (!bot) {
      throw new Error('Telegram bot not configured');
    }
    await bot.telegram.getMe();
    await this.recordMetric('health.telegram', 1, 'count');
  }

  private async saveHealthCheck(
    service: string,
    isHealthy: boolean,
    responseTime: number,
    error?: string,
  ): Promise<void> {
    const existing = await this.healthRepository.findOne({ where: { service } });

    if (existing) {
      existing.isHealthy = isHealthy;
      existing.responseTime = responseTime;
      existing.lastCheckAt = new Date();
      existing.consecutiveFailures = isHealthy ? 0 : existing.consecutiveFailures + 1;
      if (error) existing.lastError = error;
      await this.healthRepository.save(existing);
    } else {
      await this.healthRepository.save({
        service,
        isHealthy,
        responseTime,
        consecutiveFailures: isHealthy ? 0 : 1,
        lastCheckAt: new Date(),
        lastError: error,
      });
    }
  }

  async checkStuckDeals(): Promise<void> {
    try {
      const threshold = new Date(Date.now() - 30 * 60 * 1000);
      const stuck = await this.dealRepo.find({
        where: {
          status: In([
            DealStatus.PENDING_PAYMENT,
            DealStatus.PENDING_ACCEPTANCE,
            DealStatus.IN_PROGRESS,
          ]),
          updatedAt: LessThan(threshold),
        },
        take: 50,
      });

      for (const deal of stuck) {
        await this.createAlert(
          AlertType.DEAL_STUCK,
          AlertSeverity.WARNING,
          `Deal stuck: ${deal.dealNumber}`,
          `Status ${deal.status} unchanged for 30+ minutes`,
          { dealId: deal.id, status: deal.status },
        );
      }

      if (stuck.length > 5) {
        await this.createAlert(
          AlertType.SYSTEM_ERROR,
          AlertSeverity.WARNING,
          'Multiple stuck deals detected',
          `${stuck.length} deals may be stuck`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to check stuck deals: ${error.message}`);
    }
  }

  async checkTreasuryReserve(): Promise<void> {
    if (!this.blockchainProvider.isReady) {
      return;
    }
    try {
      const threshold = BigInt(
        this.config.get<string>('TREASURY_LOW_RESERVE_RAW', '1000000000'),
      );
      const { reserve } = await this.treasury.balances();
      await this.recordMetric('treasury.reserve', Number(reserve), 'base_units');
      if (reserve < threshold) {
        await this.createAlert(
          AlertType.SYSTEM_ERROR,
          AlertSeverity.WARNING,
          'Treasury reserve below threshold',
          `Reserve ${reserve.toString()} < ${threshold.toString()} (raw token units)`,
        );
      }
    } catch (error) {
      this.logger.error(`Treasury reserve check failed: ${(error as Error).message}`);
    }
  }

  async checkPendingPayments(): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const stale = await this.paymentRepo.count({
        where: {
          status: PaymentStatus.PENDING,
          createdAt: LessThan(oneHourAgo),
        },
      });
      await this.recordMetric('monitoring.payments_checked', stale, 'count');
      if (stale > 10) {
        await this.createAlert(
          AlertType.ARBITRATION_PENDING,
          AlertSeverity.INFO,
          'Stale pending payments',
          `${stale} payments pending over 1 hour`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to check pending payments: ${error.message}`);
    }
  }

  async cleanupOldAlerts(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await this.alertRepository.delete({
        createdAt: LessThan(thirtyDaysAgo),
        isResolved: true,
      });
      await this.recordMetric('monitoring.alerts_cleaned', 1, 'count');
    } catch (error) {
      this.logger.error(`Failed to cleanup old alerts: ${error.message}`);
    }
  }

  async createAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message?: string,
    metadata?: Record<string, any>,
  ): Promise<SystemAlert> {
    const alert = await this.alertRepository.save({
      type,
      severity,
      title,
      message,
      metadata,
    });

    if (severity === AlertSeverity.CRITICAL) {
      this.logger.error(`CRITICAL ALERT: ${title} - ${message}`);
    } else if (severity === AlertSeverity.ERROR) {
      this.logger.warn(`ERROR ALERT: ${title} - ${message}`);
    }

    return alert;
  }

  async resolveAlert(alertId: string, resolvedBy: string, resolution: string): Promise<void> {
    await this.alertRepository.update(alertId, {
      isResolved: true,
      resolvedBy,
      resolvedAt: new Date(),
      resolution,
    });
  }

  async getActiveAlerts(severity?: AlertSeverity): Promise<SystemAlert[]> {
    const where: any = { isResolved: false };
    if (severity) where.severity = severity;
    return this.alertRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getSystemStats(): Promise<Record<string, any>> {
    const [alertCount, healthCount, metricsCount] = await Promise.all([
      this.alertRepository.count({ where: { isResolved: false } }),
      this.healthRepository.count(),
      this.metricsRepository.count(),
    ]);

    const recentAlerts = await this.alertRepository.find({
      where: { isResolved: false },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return {
      activeAlerts: alertCount,
      healthChecks: healthCount,
      totalMetrics: metricsCount,
      recentAlerts,
      timestamp: new Date(),
    };
  }

  async getMetricsHistory(
    metric: string,
    from: Date,
    to: Date,
  ): Promise<SystemMetrics[]> {
    return this.metricsRepository.find({
      where: {
        metric,
        timestamp: MoreThan(from),
      },
      order: { timestamp: 'ASC' },
    });
  }

  async logRecovery(
    incidentType: string,
    description: string,
    affectedEntities: Record<string, any>,
    autoRecovered: boolean,
    rootCause?: string,
    fixApplied?: string,
  ): Promise<RecoveryLog> {
    return this.recoveryRepository.save({
      incidentType,
      description,
      affectedEntities,
      autoRecovered,
      rootCause,
      fixApplied,
      severity: autoRecovered ? AlertSeverity.INFO : AlertSeverity.WARNING,
    });
  }

  async getRecoveryHistory(limit = 50): Promise<RecoveryLog[]> {
    return this.recoveryRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getPrometheusStyleMetrics(): Promise<Record<string, number>> {
    const outbox = await this.outbox.getStats();
    const activeAlerts = await this.alertRepository.count({
      where: { isResolved: false },
    });
    const pendingPayments = await this.paymentRepo.count({
      where: { status: PaymentStatus.PENDING },
    });
    return {
      outbox_pending: outbox.pending,
      outbox_dead: outbox.dead,
      alerts_active: activeAlerts,
      payments_pending: pendingPayments,
    };
  }
}