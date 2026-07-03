import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { TonFundingLockService } from './ton-funding-lock.service';

const ESCROW = '0x' + 'a'.repeat(40);
const OTHER = '0x' + 'b'.repeat(40);

describe('TonFundingLockService', () => {
  let redis: { set: jest.Mock; del: jest.Mock };

  async function setup(
    configValues: Record<string, string> = {},
  ): Promise<TonFundingLockService> {
    redis = {
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TonFundingLockService,
        { provide: getRedisConnectionToken(), useValue: redis },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string, d?: string) => configValues[k] ?? d,
          },
        },
      ],
    }).compile();
    return moduleRef.get(TonFundingLockService);
  }

  describe('with Redis', () => {
    it('acquires the lock via SET NX PX and releases via DEL', async () => {
      const svc = await setup();

      await expect(svc.acquire(ESCROW)).resolves.toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        `lock:ton-fund:${ESCROW.toLowerCase()}`,
        '1',
        'PX',
        120_000,
        'NX',
      );

      await svc.release(ESCROW);
      expect(redis.del).toHaveBeenCalledWith(
        `lock:ton-fund:${ESCROW.toLowerCase()}`,
      );
    });

    it('honours a custom TTL from configuration', async () => {
      const svc = await setup({ TON_FUNDING_LOCK_TTL_MS: '5000' });
      await svc.acquire(ESCROW);
      expect(redis.set).toHaveBeenCalledWith(
        expect.any(String),
        '1',
        'PX',
        5000,
        'NX',
      );
    });

    it('fails to acquire when another instance holds the Redis lock', async () => {
      const svc = await setup();
      redis.set.mockResolvedValue(null); // NX rejected

      await expect(svc.acquire(ESCROW)).resolves.toBe(false);
    });

    it('normalises the escrow address to a case-insensitive key', async () => {
      const svc = await setup();
      await svc.acquire(ESCROW.toUpperCase());
      expect(redis.set).toHaveBeenCalledWith(
        `lock:ton-fund:${ESCROW.toLowerCase()}`,
        '1',
        'PX',
        120_000,
        'NX',
      );
    });

    it('serialises same-instance racing acquisitions without a Redis round-trip', async () => {
      const svc = await setup();
      await expect(svc.acquire(ESCROW)).resolves.toBe(true);
      // Second acquire for the same escrow is refused by the local guard.
      await expect(svc.acquire(ESCROW)).resolves.toBe(false);
      expect(redis.set).toHaveBeenCalledTimes(1);

      // A different escrow is independent.
      await expect(svc.acquire(OTHER)).resolves.toBe(true);
    });

    it('degrades to the in-memory guard when Redis throws', async () => {
      const svc = await setup();
      redis.set.mockRejectedValue(new Error('Redis down'));

      // Still acquires (single-instance safety preserved)...
      await expect(svc.acquire(ESCROW)).resolves.toBe(true);
      // ...and blocks a concurrent same-instance acquire.
      await expect(svc.acquire(ESCROW)).resolves.toBe(false);
    });

    it('swallows Redis errors on release (lock frees via TTL)', async () => {
      const svc = await setup();
      await svc.acquire(ESCROW);
      redis.del.mockRejectedValue(new Error('Redis down'));

      await expect(svc.release(ESCROW)).resolves.toBeUndefined();
      // The local guard is cleared, so a re-acquire succeeds.
      await expect(svc.acquire(ESCROW)).resolves.toBe(true);
    });
  });

  describe('SQLite dev mode (no Redis)', () => {
    it('never touches Redis and relies on the in-memory guard', async () => {
      const svc = await setup({ DB_USE_SQLITE: 'true' });

      await expect(svc.acquire(ESCROW)).resolves.toBe(true);
      await expect(svc.acquire(ESCROW)).resolves.toBe(false);
      await svc.release(ESCROW);
      await expect(svc.acquire(ESCROW)).resolves.toBe(true);

      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });
});
