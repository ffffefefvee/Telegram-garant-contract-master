import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { OutboxService } from '../ops/outbox.service';
import { NotificationDispatcher } from './notification-dispatcher.service';

/**
 * Polls `outbox_events` every 10 seconds, dispatches each claimed event
 * to the NotificationDispatcher, and reports delivery status back to the
 * outbox.
 *
 * Gated by `NOTIFICATIONS_ENABLED` env (default `true`). Set to `"false"`
 * to disable the cron in CI/tests without removing the provider from the
 * DI graph (so unit tests can still construct the dispatcher directly).
 */
@Injectable()
export class NotificationWorkerScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationWorkerScheduler.name);
  private running = false;
  private enabled = true;

  constructor(
    private readonly outbox: OutboxService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('NOTIFICATIONS_ENABLED', 'true');
    this.enabled = raw !== 'false';
    if (!this.enabled) {
      try {
        this.registry.deleteCronJob('notifications.tick');
      } catch {
        // not yet registered — fine
      }
      this.logger.log(
        'Notification worker disabled (NOTIFICATIONS_ENABLED=false)',
      );
    } else {
      this.logger.log('Notification worker enabled (10s poll interval)');
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'notifications.tick' })
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.running) return;
    this.running = true;
    try {
      const batch = await this.outbox.claimBatch(25);
      if (batch.length === 0) return;

      for (const event of batch) {
        try {
          const result = await this.dispatcher.dispatch(event);
          if (result.deferredMs && result.deferredMs > 0) {
            await this.outbox.enqueue({
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              eventType: event.eventType,
              payload: event.payload,
              availableAt: new Date(Date.now() + result.deferredMs),
            });
          }
          // Unhandled events are just absent templates — mark delivered
          // so they don't re-fire forever. If you need a template,
          // register one and replay manually.
          await this.outbox.markDelivered(event.id);
          if (result.delivered + result.skipped > 0 || result.unhandled) {
            this.logger.debug(
              `Outbox ${event.eventType} id=${event.id}: delivered=${result.delivered} skipped=${result.skipped} unhandled=${result.unhandled}`,
            );
          }
        } catch (err) {
          const e = err as Error;
          this.logger.error(
            `Outbox ${event.eventType} id=${event.id} delivery failed: ${e.message}`,
          );
          await this.outbox.markFailed(event.id, e);
        }
      }
    } catch (err) {
      this.logger.error(
        `Notification worker tick failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
