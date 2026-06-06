import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import { User } from '../user/entities/user.entity';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { NotificationTemplateRegistry } from './notification-template.registry';
import { NotificationWorkerScheduler } from './notification-worker.scheduler';
import { NotificationController } from './notification.controller';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';
import { OpsModule } from '../ops/ops.module';
import { Deal } from '../deal/entities/deal.entity';
import { DealReminderScheduler } from './deal-reminder.scheduler';

/**
 * H2S1 PR 1/3 — notification delivery pipeline:
 *
 *   outbox_events → NotificationWorkerScheduler (cron, 10s)
 *                 → NotificationDispatcher (lookup template, filter
 *                    by user preferences, render per-recipient)
 *                 → TelegramBotService.sendMessage
 *
 * `NotificationPreferenceService` is the self-service controller's
 * backing; `NotificationTemplateRegistry` is the extensible mapping from
 * outbox `eventType` → message body + recipients.
 *
 * Cron is gated by `NOTIFICATIONS_ENABLED` (default true) — set to
 * `"false"` in CI so we don't poll the DB on every test run.
 */
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([NotificationPreference, User, Deal]),
    TelegramBotModule,
    OpsModule,
  ],
  providers: [
    NotificationPreferenceService,
    NotificationDispatcher,
    NotificationTemplateRegistry,
    NotificationWorkerScheduler,
    DealReminderScheduler,
  ],
  controllers: [NotificationController],
  exports: [NotificationPreferenceService, NotificationDispatcher],
})
export class NotificationsModule {}
