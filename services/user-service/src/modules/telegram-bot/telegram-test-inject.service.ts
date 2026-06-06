import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Update } from 'telegraf/types';
import { TelegramBotService } from './telegram-bot.service';
import {
  TelegramTestCapture,
  TelegramTestInjectResult,
} from './telegram-test-inject.types';

@Injectable()
export class TelegramTestInjectService {
  private readonly logger = new Logger(TelegramTestInjectService.name);
  private updateIdSeq = 900_000;
  private lastBotMessage: {
    message_id: number;
    chat: { id: number; type: 'private' };
    date: number;
    reply_markup?: unknown;
  } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly botService: TelegramBotService,
  ) {}

  isEnabled(): boolean {
    const enabled = this.config.get<string>('TELEGRAM_TEST_INJECT_ENABLED', '') === 'true';
    const env = this.config.get<string>('NODE_ENV', 'development');
    const hasBot = !!this.botService.getBot();
    return enabled && env !== 'production' && hasBot;
  }

  assertEnabled(secretHeader: string | undefined): void {
    if (!this.isEnabled()) {
      throw new ForbiddenException(
        'Telegram test inject is disabled (TELEGRAM_TEST_INJECT_ENABLED=true, NODE_ENV!=production, bot running)',
      );
    }

    const expected = this.config.get<string>('TELEGRAM_TEST_INJECT_SECRET', '');
    if (!expected || secretHeader !== expected) {
      throw new ForbiddenException('Invalid or missing X-Telegram-Test-Secret');
    }
  }

  private getTestChatId(): number {
    const raw = this.config.get<string>('TELEGRAM_CHAT_ID', '');
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) {
      throw new ForbiddenException('TELEGRAM_CHAT_ID must be a positive number in .env');
    }
    return id;
  }

  private nextUpdateId(): number {
    this.updateIdSeq += 1;
    return this.updateIdSeq;
  }

  private testUser() {
    const id = this.getTestChatId();
    return {
      id,
      is_bot: false as const,
      first_name: 'Test',
      username: 'test_user',
      language_code: 'ru',
    };
  }

  private testChat() {
    const id = this.getTestChatId();
    return { id, type: 'private' as const };
  }

  buildMessageUpdate(text: string): Update {
    const chat = this.testChat();
    const date = Math.floor(Date.now() / 1000);
    const trimmed = text.trim();
    const message: Record<string, unknown> = {
      message_id: this.nextUpdateId(),
      date,
      chat,
      from: this.testUser(),
      text: trimmed,
    };
    if (trimmed.startsWith('/')) {
      const command = trimmed.split(/\s+/)[0];
      message.entities = [{ type: 'bot_command', offset: 0, length: command.length }];
    }
    return {
      update_id: this.nextUpdateId(),
      message,
    } as unknown as Update;
  }

  buildCallbackUpdate(data: string): Update {
    if (!this.lastBotMessage) {
      throw new ForbiddenException(
        'No prior bot message for callback inject — call /test/command first',
      );
    }

    const from = this.testUser();
    const queryId = `test_${this.nextUpdateId()}`;

    return {
      update_id: this.nextUpdateId(),
      callback_query: {
        id: queryId,
        from,
        chat_instance: 'test_inject',
        data,
        message: {
          ...this.lastBotMessage,
          from: {
            id: this.botService.getBotTelegramId(),
            is_bot: true,
            first_name: 'Bot',
            username: 'bot',
          },
        },
      },
    } as Update;
  }

  private storeCapture(capture: TelegramTestCapture | null): void {
    if (!capture?.messageId || !capture.chatId) {
      return;
    }

    this.lastBotMessage = {
      message_id: capture.messageId,
      chat: { id: capture.chatId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      reply_markup: capture.replyMarkup,
    };
  }

  async injectUpdate(update: Update): Promise<TelegramTestInjectResult> {
    try {
      const capture = await this.botService.handleInjectUpdate(update);
      this.storeCapture(capture);
      return { ok: true, capture };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Inject update failed: ${message}`, error);
      return { ok: false, capture: null, error: message };
    }
  }

  async injectCommand(text: string): Promise<TelegramTestInjectResult> {
    return this.injectUpdate(this.buildMessageUpdate(text));
  }

  async injectCallback(data: string): Promise<TelegramTestInjectResult> {
    return this.injectUpdate(this.buildCallbackUpdate(data));
  }
}
