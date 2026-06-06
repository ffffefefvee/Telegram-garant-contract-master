import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validates a Telegram WebApp `initData` payload as documented at:
 *   https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * The mini-app forwards the raw `window.Telegram.WebApp.initData` string
 * (URL-encoded form-data) to the backend. We:
 *   1. Parse it as a URLSearchParams.
 *   2. Strip the `hash` field (the rest is the data-check-string).
 *   3. Build `data_check_string = sorted_keys.map(k => `${k}=${v}`).join('\n')`.
 *   4. Compute `secret_key = HMAC_SHA256("WebAppData", botToken)`.
 *   5. Compute `expected_hash = HMAC_SHA256(secret_key, data_check_string)`.
 *   6. Compare `expected_hash` to the provided `hash` in constant time.
 *   7. Reject if `auth_date` is older than `maxAgeSeconds` (default 24h).
 *
 * Returns the parsed `user` object (Telegram user info) on success, or throws.
 */

export interface TelegramInitDataUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramInitData {
  user: TelegramInitDataUser;
  query_id?: string;
  auth_date: number;
  hash: string;
  start_param?: string;
  /** All raw key/value pairs as parsed, useful for downstream debugging. */
  raw: Record<string, string>;
}

export class TelegramInitDataError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TelegramInitDataError';
  }
}

const MAX_AGE_SECONDS_DEFAULT = 24 * 60 * 60; // 24 hours

export function validateInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: () => number } = {},
): TelegramInitData {
  if (!initData) {
    throw new TelegramInitDataError('initData is empty', 'EMPTY');
  }
  if (!botToken) {
    throw new TelegramInitDataError('bot token not configured', 'NO_TOKEN');
  }

  const params = new URLSearchParams(initData);
  const raw: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    raw[k] = v;
  }

  const providedHash = raw.hash;
  if (!providedHash) {
    throw new TelegramInitDataError('hash field missing', 'NO_HASH');
  }

  // Build data-check-string: sort keys alphabetically, exclude `hash`.
  const dataCheckString = Object.keys(raw)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${raw[k]}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time comparison.
  if (expectedHash.length !== providedHash.length) {
    throw new TelegramInitDataError('invalid hash', 'BAD_HASH');
  }
  const a = Buffer.from(expectedHash, 'utf8');
  const b = Buffer.from(providedHash, 'utf8');
  if (!timingSafeEqual(a, b)) {
    throw new TelegramInitDataError('invalid hash', 'BAD_HASH');
  }

  const authDate = Number.parseInt(raw.auth_date, 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new TelegramInitDataError('invalid auth_date', 'BAD_AUTH_DATE');
  }

  const now = (options.now ?? Date.now)() / 1000;
  const maxAge = options.maxAgeSeconds ?? MAX_AGE_SECONDS_DEFAULT;
  if (now - authDate > maxAge) {
    throw new TelegramInitDataError(
      `initData expired (auth_date ${authDate}, now ${now.toFixed(0)})`,
      'EXPIRED',
    );
  }

  if (!raw.user) {
    throw new TelegramInitDataError('user field missing', 'NO_USER');
  }

  let parsedUser: TelegramInitDataUser;
  try {
    parsedUser = JSON.parse(raw.user) as TelegramInitDataUser;
  } catch {
    throw new TelegramInitDataError('user field is not valid JSON', 'BAD_USER');
  }
  if (typeof parsedUser.id !== 'number') {
    throw new TelegramInitDataError('user.id missing or not a number', 'BAD_USER');
  }

  return {
    user: parsedUser,
    query_id: raw.query_id,
    auth_date: authDate,
    hash: providedHash,
    start_param: raw.start_param,
    raw,
  };
}
