import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

const SESSION_PREFIX = 'tg:session:';
const SESSION_TTL_SEC = 60 * 60 * 24; // 24h

/** In-memory fallback when Redis is unavailable. */
const memorySessions = new Map<number, Record<string, unknown>>();

let sessionStoreInstance: TelegramSessionStore | null = null;

@Injectable()
export class TelegramSessionStore implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramSessionStore.name);
  private readonly useRedis: boolean;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.useRedis = config.get('TELEGRAM_SESSION_REDIS', 'true') !== 'false';
    // Intentional module-level singleton: Telegraf session middleware is
    // constructed outside Nest DI and reaches the store through this handle.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    sessionStoreInstance = this;
  }

  onModuleDestroy(): void {
    if (sessionStoreInstance === this) {
      sessionStoreInstance = null;
    }
  }

  async get(chatId: number): Promise<Record<string, unknown>> {
    if (this.useRedis) {
      try {
        const raw = await this.redis.get(`${SESSION_PREFIX}${chatId}`);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          memorySessions.set(chatId, parsed);
          return parsed;
        }
        if (!memorySessions.has(chatId)) {
          memorySessions.set(chatId, {});
        }
        return memorySessions.get(chatId)!;
      } catch (err) {
        this.logger.warn(`Redis session read failed, using memory: ${(err as Error).message}`);
      }
    }
    if (!memorySessions.has(chatId)) {
      memorySessions.set(chatId, {});
    }
    return memorySessions.get(chatId)!;
  }

  async save(chatId: number, session: Record<string, unknown>): Promise<void> {
    if (this.useRedis) {
      try {
        await this.redis.setex(
          `${SESSION_PREFIX}${chatId}`,
          SESSION_TTL_SEC,
          JSON.stringify(session),
        );
        memorySessions.set(chatId, session);
        return;
      } catch (err) {
        this.logger.warn(`Redis session write failed, using memory: ${(err as Error).message}`);
      }
    }
    memorySessions.set(chatId, session);
  }

  async clear(chatId: number): Promise<void> {
    if (this.useRedis) {
      try {
        await this.redis.del(`${SESSION_PREFIX}${chatId}`);
      } catch {
        // ignore
      }
    }
    memorySessions.delete(chatId);
  }
}

/** Used by Telegraf middleware before DI context is available per-update. */
export function getChatSession(chatId: number): Record<string, unknown> {
  if (!memorySessions.has(chatId)) {
    memorySessions.set(chatId, {});
  }
  return memorySessions.get(chatId)!;
}

export async function persistChatSession(chatId: number): Promise<void> {
  const session = memorySessions.get(chatId);
  if (session && sessionStoreInstance) {
    await sessionStoreInstance.save(chatId, session);
  }
}

export function clearChatSession(chatId: number): void {
  memorySessions.delete(chatId);
  void sessionStoreInstance?.clear(chatId);
}
