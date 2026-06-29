import { BadRequestException } from '@nestjs/common';
import {
  parseUsdtToWei,
  weiToUsdtNumber,
  normalizeUsdtAmount,
} from './usdt-amount';

describe('parseUsdtToWei', () => {
  it('parses whole amounts', () => {
    expect(parseUsdtToWei('100')).toBe(100_000_000n);
    expect(parseUsdtToWei(100)).toBe(100_000_000n);
  });

  it('preserves up to 6 decimals exactly (no float drift)', () => {
    expect(parseUsdtToWei('123.456789')).toBe(123_456_789n);
    // 0.1 + 0.2 famously != 0.3 in float; the string path is exact.
    expect(parseUsdtToWei('0.3')).toBe(300_000n);
  });

  it('truncates digits beyond 6 decimals (never rounds up — no over-credit)', () => {
    expect(parseUsdtToWei('1.2345678')).toBe(1_234_567n);
    expect(parseUsdtToWei('0.9999999')).toBe(999_999n);
  });

  it('accepts zero', () => {
    expect(parseUsdtToWei('0')).toBe(0n);
    expect(parseUsdtToWei(0)).toBe(0n);
  });

  it.each([NaN, Infinity, -Infinity, -1, -0.01])(
    'rejects invalid number %p',
    (bad) => {
      expect(() => parseUsdtToWei(bad)).toThrow(BadRequestException);
    },
  );

  it.each(['', '  ', 'abc', '1.2.3', '1e3', '0x10', '-5', '1,5'])(
    'rejects malformed string %p',
    (bad) => {
      expect(() => parseUsdtToWei(bad)).toThrow(BadRequestException);
    },
  );

  it('rejects amounts above the sanity cap', () => {
    expect(() => parseUsdtToWei('1000000001')).toThrow(BadRequestException);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseUsdtToWei('  42.5  ')).toBe(42_500_000n);
  });
});

describe('weiToUsdtNumber', () => {
  it('round-trips a parsed amount', () => {
    expect(weiToUsdtNumber(parseUsdtToWei('123.45'))).toBeCloseTo(123.45, 6);
  });
});

describe('normalizeUsdtAmount', () => {
  it('canonicalizes a valid string to a number', () => {
    expect(normalizeUsdtAmount('123.456789')).toBeCloseTo(123.456789, 6);
  });

  it('returns null for garbage instead of throwing (NaN-safe)', () => {
    expect(normalizeUsdtAmount('')).toBeNull();
    expect(normalizeUsdtAmount('not-a-number')).toBeNull();
    expect(normalizeUsdtAmount(NaN)).toBeNull();
  });
});
