import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

/** Redis key namespace for per-escrow TON funding locks. */
const LOCK_KEY_PREFIX = 'lock:ton-fund:';
/** Default lock lifetime: one `forwardAndFund` round-trip plus generous slack. */
const DEFAULT_LOCK_TTL_MS = 120_000;

/**
 * Distributed per-escrow funding lock for the TON rails.
 *
 * Protects the relay float from a double `forwardAndFund` when the watcher
 * tick and a user-triggered `checkStatus` race for the same escrow — across
 * process restarts and horizontally-scaled instances alike.
 *
 * Two layers:
 *  1. Redis `SET <key> NX PX <ttl>` — cross-instance mutual exclusion. The
 *     TTL is a safety net: if the holder crashes mid-forward, the lock frees
 *     itself instead of wedging the escrow forever.
 *  2. An in-memory `Set` — same-instance guard AND graceful fallback when
 *     Redis is down/disabled (SQLite dev mode). A single instance stays safe
 *     even without Redis; multi-instance safety simply needs Redis reachable.
 *
 * Mirrors the degrade-to-memory pattern of `TelegramSessionStore`.
 */
@Injectable()
export class TonFundingLockService {
  private readonly logger = new Logger(TonFundingLockService.name);
  private readonly ttlMs: number;
  private readonly useRedis: boolean;
  private readonly localLocks = new Set<string>();

  constructor(
    @InjectRedis() private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.ttlMs = Number(
      config.get<string>('TON_FUNDING_LOCK_TTL_MS', String(DEFAULT_LOCK_TTL_MS)),
    );
    // SQLite dev mode runs without a real Redis — stay on the memory guard.
    this.useRedis = config.get('DB_USE_SQLITE') !== 'true';
  }

  private key(escrowAddress: string): string {
    return `${LOCK_KEY_PREFIX}${escrowAddress.toLowerCase()}`;
  }

  /**
   * Try to claim the funding lock for `escrowAddress`.
   * @returns `true` when acquired (caller must `release`), `false` when the
   * lock is already held (by this instance or another).
   */
  async acquire(escrowAddress: string): Promise<boolean> {
    // Cheap same-instance short-circuit — also the sole guard if Redis fails.
    if (this.localLocks.has(escrowAddress)) {
      return false;
    }
    if (this.useRedis) {
      try {
        const res = await this.redis.set(
          this.key(escrowAddress),
          '1',
          'PX',
          this.ttlMs,
          'NX',
        );
        if (res !== 'OK') {
          return false; // held by another instance
        }
      } catch (err) {
        this.logger.warn(
          `Redis lock unavailable, falling back to in-memory guard: ${(err as Error).message}`,
        );
      }
    }
    this.localLocks.add(escrowAddress);
    return true;
  }

  /** Release the funding lock. Safe to call even if acquire partly failed. */
  async release(escrowAddress: string): Promise<void> {
    this.localLocks.delete(escrowAddress);
    if (this.useRedis) {
      try {
        await this.redis.del(this.key(escrowAddress));
      } catch (err) {
        this.logger.warn(
          `Redis lock release failed (will expire via TTL): ${(err as Error).message}`,
        );
      }
    }
  }
}
