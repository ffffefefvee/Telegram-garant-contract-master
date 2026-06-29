import { BadRequestException } from '@nestjs/common';

/** USDT uses 6 decimals on every chain we support. */
export const USDT_DECIMALS = 6;
const WEI_PER_USDT = 10n ** BigInt(USDT_DECIMALS);

/** Largest USDT amount we ever expect; guards against absurd/overflow inputs. */
const MAX_USDT = 1_000_000_000; // 1 billion USDT

/**
 * Parse a USDT amount into integer 6-decimal "wei", the unit the contracts
 * use. This is the money trust-boundary: amounts arriving as provider strings
 * (Cryptomus `currency_amount`) are parsed WITHOUT a float round-trip, so no
 * precision is lost and malformed input is rejected loudly instead of silently
 * becoming NaN.
 *
 * Rules:
 *  - string: must be a plain non-negative decimal (`"12.34"`). Fractional
 *    digits beyond 6 are TRUNCATED (never round up — we must not over-credit).
 *  - number: must be finite and non-negative; rounded to 6 decimals.
 *  - anything else (NaN, Infinity, negative, garbage, empty) → 400.
 */
export function parseUsdtToWei(value: string | number): bigint {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`Invalid USDT amount: ${value}`);
    }
    // Round to the smallest unit, then parse the canonical string form.
    text = value.toFixed(USDT_DECIMALS);
  } else {
    text = (value ?? '').trim();
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new BadRequestException(`Invalid USDT amount: "${value}"`);
  }
  const whole = match[1];
  const fractionTruncated = (match[2] ?? '')
    .slice(0, USDT_DECIMALS)
    .padEnd(USDT_DECIMALS, '0');

  const wei = BigInt(whole) * WEI_PER_USDT + BigInt(fractionTruncated);
  if (wei > BigInt(MAX_USDT) * WEI_PER_USDT) {
    throw new BadRequestException(`USDT amount exceeds maximum: "${value}"`);
  }
  return wei;
}

/**
 * Convert integer 6-decimal wei back to a JS number. Safe for our bounded
 * amounts (< 1e9 USDT → < 1e15 wei, within Number.MAX_SAFE_INTEGER).
 */
export function weiToUsdtNumber(wei: bigint): number {
  return Number(wei) / Number(WEI_PER_USDT);
}

/**
 * Canonicalize a USDT amount to a clean ≤6-decimal JS number by routing it
 * through wei. Use this before persisting amounts that originate from provider
 * strings or user input, so stored values never carry float drift or NaN.
 * Returns null when the input cannot be parsed (caller decides the fallback).
 */
export function normalizeUsdtAmount(value: string | number): number | null {
  try {
    return weiToUsdtNumber(parseUsdtToWei(value));
  } catch {
    return null;
  }
}
