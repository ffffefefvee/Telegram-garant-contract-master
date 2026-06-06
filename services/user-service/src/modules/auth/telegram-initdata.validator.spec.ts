import { createHmac } from 'crypto';
import {
  validateInitData,
  TelegramInitDataError,
} from './telegram-initdata.validator';

const BOT_TOKEN = '1234567890:TEST_BOT_TOKEN_FOR_HMAC_SUITE';

/**
 * Build a syntactically valid initData string and sign it the same way
 * Telegram does. Lets us exercise the validator without a real Telegram
 * payload.
 */
function buildInitData(overrides: {
  user?: object;
  authDate?: number;
  botToken?: string;
  tamper?: 'hash' | 'user' | 'auth_date';
}): string {
  const user = overrides.user ?? { id: 42, first_name: 'Alice', username: 'alice' };
  const authDate = overrides.authDate ?? Math.floor(Date.now() / 1000);
  const fields: Record<string, string> = {
    user: JSON.stringify(user),
    auth_date: String(authDate),
    query_id: 'q-test',
  };
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(overrides.botToken ?? BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  fields.hash = overrides.tamper === 'hash' ? '0'.repeat(64) : hash;
  if (overrides.tamper === 'user') fields.user = JSON.stringify({ ...user, id: 999 });
  if (overrides.tamper === 'auth_date') fields.auth_date = String(authDate + 1);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, v);
  return params.toString();
}

describe('validateInitData', () => {
  it('accepts a freshly-signed payload and returns parsed user', () => {
    const data = buildInitData({});
    const result = validateInitData(data, BOT_TOKEN);
    expect(result.user.id).toBe(42);
    expect(result.user.username).toBe('alice');
    expect(result.query_id).toBe('q-test');
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an empty initData string', () => {
    expect(() => validateInitData('', BOT_TOKEN)).toThrow(TelegramInitDataError);
  });

  it('rejects when bot token is empty', () => {
    const data = buildInitData({});
    expect(() => validateInitData(data, '')).toThrow(/bot token not configured/);
  });

  it('rejects when hash field is missing', () => {
    const data = 'user=%7B%22id%22%3A42%7D&auth_date=1700000000';
    expect(() => validateInitData(data, BOT_TOKEN)).toThrow(/hash field missing/);
  });

  it('rejects a tampered hash (constant-time compare)', () => {
    const data = buildInitData({ tamper: 'hash' });
    expect(() => validateInitData(data, BOT_TOKEN)).toThrow(/invalid hash/);
  });

  it('rejects when any signed field is changed after signing', () => {
    const data = buildInitData({ tamper: 'auth_date' });
    expect(() => validateInitData(data, BOT_TOKEN)).toThrow(/invalid hash/);
  });

  it('rejects when bot token does not match the signing token', () => {
    const data = buildInitData({});
    expect(() => validateInitData(data, BOT_TOKEN + 'X')).toThrow(/invalid hash/);
  });

  it('rejects an expired payload (auth_date older than maxAge)', () => {
    const oldDate = Math.floor(Date.now() / 1000) - 48 * 3600; // 48h ago
    const data = buildInitData({ authDate: oldDate });
    expect(() => validateInitData(data, BOT_TOKEN, { maxAgeSeconds: 24 * 3600 })).toThrow(
      /initData expired/,
    );
  });

  it('accepts an expired payload when maxAge is generous enough', () => {
    const oldDate = Math.floor(Date.now() / 1000) - 48 * 3600;
    const data = buildInitData({ authDate: oldDate });
    expect(() => validateInitData(data, BOT_TOKEN, { maxAgeSeconds: 72 * 3600 })).not.toThrow();
  });

  it('rejects when user.id is missing', () => {
    const data = buildInitData({ user: { first_name: 'Anon' } });
    expect(() => validateInitData(data, BOT_TOKEN)).toThrow(/user.id missing/);
  });

  it('preserves all raw fields for downstream debugging', () => {
    const data = buildInitData({});
    const result = validateInitData(data, BOT_TOKEN);
    expect(result.raw).toMatchObject({
      query_id: 'q-test',
      hash: result.hash,
      auth_date: String(result.auth_date),
    });
  });
});
