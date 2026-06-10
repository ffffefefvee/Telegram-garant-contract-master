import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { CryptomusService, CryptomusWebhookPayload } from './cryptomus.service';

const API_KEY = 'test-api-key';

function sign(body: string, apiKey: string = API_KEY): string {
  return crypto
    .createHash('md5')
    .update(Buffer.from(body).toString('base64') + apiKey)
    .digest('hex');
}

function makeService(apiKey: string | undefined = API_KEY): CryptomusService {
  const config = {
    get: jest.fn((key: string, def?: string) => {
      if (key === 'CRYPTOMUS_API_KEY') return apiKey ?? def;
      if (key === 'CRYPTOMUS_MERCHANT_ID') return 'merchant-1';
      return def;
    }),
  } as unknown as ConfigService;
  return new CryptomusService(config);
}

const payload: CryptomusWebhookPayload = {
  type: 'payment',
  uuid: 'a3b1c2d3-0000-0000-0000-000000000000',
  order_id: 'deal-1',
  amount: '100',
  currency: 'USDT',
  currency_amount: '100',
  status: 'paid',
  txid: '0xabc',
  network: 'polygon',
  payer_amount: '100',
  payer_currency: 'USDT',
};

describe('CryptomusService.handleWebhook', () => {
  it('rejects every webhook when CRYPTOMUS_API_KEY is not configured (fail closed)', async () => {
    const service = makeService('');
    // md5(base64(body) + '') — what an attacker could compute with no key
    const forged = sign(JSON.stringify(payload), '');
    await expect(service.handleWebhook(payload, forged)).resolves.toBe(false);
  });

  it('accepts a valid signature from the sign header', async () => {
    const service = makeService();
    const valid = sign(JSON.stringify(payload));
    await expect(service.handleWebhook(payload, valid)).resolves.toBe(true);
  });

  it('accepts a valid signature embedded in the body (sign stripped before hashing)', async () => {
    const service = makeService();
    const valid = sign(JSON.stringify(payload));
    const withSign = { ...payload, sign: valid };
    await expect(service.handleWebhook(withSign, '')).resolves.toBe(true);
  });

  it('accepts PHP json_encode style bodies (escaped forward slashes)', async () => {
    const service = makeService();
    const withUrl = { ...payload, txid: 'https://polygonscan.com/tx/0xabc' };
    const phpBody = JSON.stringify(withUrl).replace(/\//g, '\\/');
    const valid = sign(phpBody);
    await expect(service.handleWebhook(withUrl, valid)).resolves.toBe(true);
  });

  it('verifies against the raw request body when key order differs from the DTO', async () => {
    const service = makeService();
    // Cryptomus serialized with a different key order than our interface
    const reordered: Record<string, unknown> = {
      order_id: payload.order_id,
      uuid: payload.uuid,
      type: payload.type,
      amount: payload.amount,
      currency: payload.currency,
      currency_amount: payload.currency_amount,
      status: payload.status,
      txid: payload.txid,
      network: payload.network,
      payer_amount: payload.payer_amount,
      payer_currency: payload.payer_currency,
    };
    const rawBody = JSON.stringify(reordered);
    const valid = sign(rawBody);
    await expect(
      service.handleWebhook(payload, valid, Buffer.from(rawBody)),
    ).resolves.toBe(true);
  });

  it('rejects an invalid signature', async () => {
    const service = makeService();
    await expect(service.handleWebhook(payload, 'deadbeef')).resolves.toBe(false);
  });

  it('rejects when no signature is provided at all', async () => {
    const service = makeService();
    await expect(service.handleWebhook(payload, '')).resolves.toBe(false);
  });
});
