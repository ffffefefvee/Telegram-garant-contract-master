import { ConfigService } from '@nestjs/config';
import { TonApiService } from './ton-api.service';

const WALLET = 'UQAWzEKcdnykvXfUNouqdS62tvrp32bCxuKS6eQrS6ISgcLo';

function makeService(env: Record<string, string> = {}): TonApiService {
  const config = {
    get: (key: string, def?: string) => env[key] ?? def,
  } as unknown as ConfigService;
  return new TonApiService(config);
}

function mockFetchResponses(
  responses: Array<{ ok: boolean; status?: number; body?: unknown }>,
): jest.Mock {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? 'OK' : 'Error',
      json: async () => r.body ?? {},
    });
  }
  return fn;
}

describe('TonApiService.getWalletBalances', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns native TON and USDT jetton balances', async () => {
    const service = makeService({ TON_WALLET_ADDRESS: WALLET });
    global.fetch = mockFetchResponses([
      { ok: true, body: { balance: 2_500_000_000 } }, // 2.5 TON in nanotons
      { ok: true, body: { balance: '150000000' } }, // 150 USDT in 6dp units
    ]) as unknown as typeof fetch;

    const balances = await service.getWalletBalances();

    expect(balances).toEqual({
      tonNano: 2_500_000_000n,
      usdtUnits: 150_000_000n,
    });
  });

  it('treats a missing jetton wallet (404) as zero USDT', async () => {
    const service = makeService({ TON_WALLET_ADDRESS: WALLET });
    global.fetch = mockFetchResponses([
      { ok: true, body: { balance: '1000000000' } },
      { ok: false, status: 404 },
    ]) as unknown as typeof fetch;

    const balances = await service.getWalletBalances();

    expect(balances).toEqual({ tonNano: 1_000_000_000n, usdtUnits: 0n });
  });

  it('returns null when the wallet is not configured', async () => {
    const service = makeService();
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    expect(await service.getWalletBalances()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws on a non-404 jetton balance failure (no silent zeros)', async () => {
    const service = makeService({ TON_WALLET_ADDRESS: WALLET });
    global.fetch = mockFetchResponses([
      { ok: true, body: { balance: '1000000000' } },
      { ok: false, status: 500 },
    ]) as unknown as typeof fetch;

    await expect(service.getWalletBalances()).rejects.toThrow(
      /jetton balance request failed/,
    );
  });

  it('throws when the account request fails', async () => {
    const service = makeService({ TON_WALLET_ADDRESS: WALLET });
    global.fetch = mockFetchResponses([
      { ok: false, status: 429 },
    ]) as unknown as typeof fetch;

    await expect(service.getWalletBalances()).rejects.toThrow(
      /account request failed/,
    );
  });
});
