import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';

/**
 * Drives `ReconciliationService.runOnce()` on a fixed cadence.
 *
 * Disabled by default — set `RECONCILIATION_ENABLED=true` to turn on. We
 * gate at the env level rather than removing the cron because in CI/tests
 * we want the class to load without ticking.
 */
@Injectable()
export class ReconciliationScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private running = false;

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<string>('RECONCILIATION_ENABLED', 'false');
    if (enabled !== 'true') {
      try {
        this.registry.deleteCronJob('reconciliation.tick');
      } catch {
        // job not yet registered (we get here before @Cron's first tick) —
        // safe to ignore.
      }
      this.logger.log('Reconciliation scheduler disabled (set RECONCILIATION_ENABLED=true to enable)');
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'reconciliation.tick' })
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.debug('Reconciliation tick skipped — previous run still in progress');
      return;
    }
    this.running = true;
    try {
      const report = await this.reconciliation.runOnce();
      const totalActions = report.payments.forwarded + report.payments.failed;
      if (totalActions > 0) {
        this.logger.log(
          `Reconciliation: payments forwarded=${report.payments.forwarded}/scanned=${report.payments.scanned} failed=${report.payments.failed}`,
        );
      }
    } catch (err) {
      this.logger.error(`Reconciliation run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
