import { FeeConsistencyService } from './fee-consistency.service';
import { D5_PERCENT_BPS } from './fee-model';

function makeFactory(readTariff: jest.Mock): any {
  return { readTariff };
}

function makeConfig(strict: boolean): any {
  return {
    get: jest.fn((key: string, def?: any) =>
      key === 'FEE_CONSISTENCY_STRICT' ? String(strict) : def,
    ),
  };
}

function makeService(factory: any, config: any): FeeConsistencyService {
  const Ctor = FeeConsistencyService as unknown as new (
    ...args: any[]
  ) => FeeConsistencyService;
  return new Ctor(factory, config);
}

describe('FeeConsistencyService', () => {
  it('passes when on-chain percent fee matches the off-chain grid', async () => {
    const factory = makeFactory(
      jest.fn(async () => ({
        threshold: 11_000_000n,
        flatFee: 550_000n,
        percentFeeBps: D5_PERCENT_BPS,
      })),
    );
    const service = makeService(factory, makeConfig(false));

    await expect(service.verify()).resolves.toBe(true);
  });

  it('skips silently in stub mode (readTariff returns null)', async () => {
    const factory = makeFactory(jest.fn(async () => null));
    const service = makeService(factory, makeConfig(true));

    // Even in strict mode a stub must not abort boot.
    await expect(service.verify()).resolves.toBe(true);
  });

  it('logs and continues on mismatch when not strict', async () => {
    const factory = makeFactory(
      jest.fn(async () => ({
        threshold: 11_000_000n,
        flatFee: 550_000n,
        percentFeeBps: D5_PERCENT_BPS + 100, // 6% vs 5%
      })),
    );
    const service = makeService(factory, makeConfig(false));

    await expect(service.verify()).resolves.toBe(false);
  });

  it('throws on mismatch when strict', async () => {
    const factory = makeFactory(
      jest.fn(async () => ({
        threshold: 11_000_000n,
        flatFee: 550_000n,
        percentFeeBps: D5_PERCENT_BPS + 100,
      })),
    );
    const service = makeService(factory, makeConfig(true));

    await expect(service.verify()).rejects.toThrow(/Fee grid mismatch/);
  });

  it('never crashes boot if readTariff throws (treated as skip)', async () => {
    const factory = makeFactory(
      jest.fn(async () => {
        throw new Error('rpc down');
      }),
    );
    const service = makeService(factory, makeConfig(true));

    await expect(service.verify()).resolves.toBe(true);
  });
});
