import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { TelegramBotService } from '../telegram-bot/telegram-bot.service';
import { OutboxEvent } from '../ops/entities/outbox-event.entity';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  NotificationTemplateRegistry,
  registerBuiltinTemplates,
  type DeeplinkBuilder,
  type Lang,
} from './notification-template.registry';

export interface DispatchResult {
  delivered: number;
  skipped: number;
  deferredMs: number | null;
  /** True if dispatcher decided this event has no template — safe to mark delivered. */
  unhandled: boolean;
}

/**
 * Consumes one outbox row at a time:
 *   1. Looks up the template for `event.eventType`.
 *   2. Extracts recipient user-ids from the payload.
 *   3. For each recipient: respects notification preferences, renders the
 *      message, sends via TelegramBotService.
 *
 * Returns a DispatchResult instead of throwing on per-recipient failure —
 * throwing would fail the whole outbox row and re-queue the same event
 * indefinitely (e.g. if one of N recipients has a stale telegramId).
 * Transport-level failures (network down) DO throw so the worker retries.
 */
@Injectable()
export class NotificationDispatcher implements OnModuleInit {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private deeplink: DeeplinkBuilder = { build: () => null };

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly registry: NotificationTemplateRegistry,
    private readonly preferences: NotificationPreferenceService,
    private readonly bot: TelegramBotService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    registerBuiltinTemplates(this.registry);
    this.deeplink = buildDeeplinkBuilder(this.config);
    this.logger.log(
      `Notification dispatcher ready. Event types: ${this.registry.listRegisteredEventTypes().join(', ') || '(none)'}`,
    );
  }

  /** Test seam — call from spec to skip onModuleInit's config dependency. */
  initForTest(): void {
    registerBuiltinTemplates(this.registry);
  }

  async dispatch(event: OutboxEvent): Promise<DispatchResult> {
    const template = this.registry.get(event.eventType);
    if (!template) {
      return { delivered: 0, skipped: 0, deferredMs: null, unhandled: true };
    }

    const recipientIds = template.recipients(event.payload);
    if (recipientIds.length === 0) {
      return { delivered: 0, skipped: 0, deferredMs: null, unhandled: false };
    }

    let delivered = 0;
    let skipped = 0;
    let deferDeltaMs: number | null = null;

    for (const userId of recipientIds) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user || !user.telegramId) {
        this.logger.warn(
          `Skip ${event.eventType}/${userId}: user missing or no telegramId`,
        );
        skipped += 1;
        continue;
      }

      const pref = await this.preferences.getOrDefault(userId);
      if (this.preferences.isMuted(pref, event.eventType)) {
        skipped += 1;
        continue;
      }

      const delay = this.preferences.quietHoursDelayMs(pref);
      if (delay > 0) {
        deferDeltaMs =
          deferDeltaMs === null ? delay : Math.max(deferDeltaMs, delay);
        skipped += 1;
        continue;
      }

      const lang = normalizeLang(user.telegramLanguageCode);
      const rendered = template.render({
        recipientUserId: userId,
        lang,
        payload: event.payload,
        deeplink: this.deeplink,
      });

      try {
        await this.bot.sendMessage(user.telegramId, rendered.text, {
          parseMode: 'HTML',
          replyMarkup: rendered.keyboard,
        });
        delivered += 1;
      } catch (err) {
        // Transport-level failure — propagate so outbox retries.
        throw err;
      }
    }

    return {
      delivered,
      skipped,
      deferredMs: deferDeltaMs,
      unhandled: false,
    };
  }
}

function normalizeLang(code: string | null | undefined): Lang {
  if (code === 'en' || code === 'es') return code;
  return 'ru';
}

/**
 * Builds Telegram MiniApp deeplinks of the form
 * `https://t.me/<bot_username>/<miniapp_slug>?startapp=<path>__<id>`.
 *
 * Telegram's `startapp` parameter is alphanumeric + `_` + `-` only and
 * <= 64 chars. We encode the route path by replacing `/` with `__` and
 * append the id with `___`. The mini-app's bootstrap reads `startapp`
 * from `WebApp.initDataUnsafe.start_param` and routes accordingly.
 *
 * Returns `null` if either env var is missing (CI/dev) — templates fall
 * back to text-only messages.
 */
export function buildDeeplinkBuilder(config: ConfigService): DeeplinkBuilder {
  const botUsername = config.get<string>('TELEGRAM_BOT_USERNAME');
  const miniappSlug = config.get<string>('TELEGRAM_MINIAPP_SLUG');
  if (!botUsername || !miniappSlug) {
    return { build: () => null };
  }
  const cleanBot = botUsername.replace(/^@/, '');
  return {
    build: (path: string, id?: string) => {
      const slug = `${path}${id ? `___${id}` : ''}`.replace(/\//g, '__');
      // Telegram limits start_param to alphanumerics, underscores, dashes.
      const safeSlug = slug.replace(/[^a-zA-Z0-9_-]/g, '');
      const truncated = safeSlug.slice(0, 64);
      return `https://t.me/${cleanBot}/${miniappSlug}?startapp=${truncated}`;
    },
  };
}
