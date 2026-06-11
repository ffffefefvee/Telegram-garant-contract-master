import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { PaymentService } from './payment.service';
import { DirectUsdtRail } from './rails/direct-usdt.rail';

/**
 * Background watcher for direct on-chain deposits. Every minute it re-checks
 * all pending/processing direct-rail payments: reads the escrow clone's USDT
 * balance and, once amount + buyerFee has arrived, settles the payment
 * (notifyFunded → deal IN_PROGRESS) via `PaymentService.checkPaymentStatus`.
 *
 * Enabled by default when the blockchain is configured; set
 * `DIRECT_DEPOSIT_WATCHER_ENABLED=false` to turn off (tests/CI).
 */
@Injectable()
export class DirectDepositWatcher implements OnModuleInit {
  private readonly logger = new Logger(DirectDepositWatcher.name);
  private running = false;
  private enabled = true;

  constructor(
    private readonly payments: PaymentService,
    private readonly directRail: DirectUsdtRail,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    this.enabled =
      this.config.get<string>('DIRECT_DEPOSIT_WATCHER_ENABLED', 'true') !== 'false';
    if (!this.enabled) {
      try {
        this.registry.deleteCronJob('direct-deposit.tick');
      } catch {
        // not yet registered — safe to ignore
      }
      this.logger.log(
        'Direct-deposit watcher disabled (DIRECT_DEPOSIT_WATCHER_ENABLED=false)',
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'direct-deposit.tick' })
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    if (!this.directRail.isAvailable()) return; // stub mode — nothing to watch
    this.running = true;
    try {
      const report = await this.runOnce();
      if (report.settled > 0 || report.expired > 0) {
        this.logger.log(
          `Direct deposits: scanned=${report.scanned} settled=${report.settled} expired=${report.expired}`,
        );
      }
    } catch (err) {
      this.logger.error(`Direct-deposit tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** One full pass; exposed for tests and manual admin triggering. */
  async runOnce(): Promise<{ scanned: number; settled: number; expired: number }> {
    const open = await this.payments.findOpenDirectPayments();
    let settled = 0;
    let expired = 0;
    for (const payment of open) {
      try {
        const updated = await this.payments.checkPaymentStatus(payment.id);
        if (updated.status === 'completed') settled += 1;
        if (updated.status === 'expired') expired += 1;
      } catch (err) {
        this.logger.warn(
          `Direct-deposit check failed for payment ${payment.id}: ${(err as Error).message}`,
        );
      }
    }
    return { scanned: open.length, settled, expired };
  }
}
