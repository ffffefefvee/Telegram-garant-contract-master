import 'reflect-metadata';
import { AuthController } from './auth.controller';
import { CryptomusWebhookController } from '../payment/cryptomus-webhook.controller';
import { HealthController } from '../monitoring/health.controller';

/**
 * Regression guard for the global rate-limiting wiring.
 *
 * The ThrottlerGuard is registered as APP_GUARD in AppModule; these tests
 * pin the per-endpoint overrides so they don't silently disappear in a
 * refactor:
 *  - auth endpoints carry a stricter 30/min limit (brute-force surface),
 *  - the Cryptomus webhook and /health are excluded from the global guard
 *    (they have their own protection / are hit by infra probes).
 */

function throttleLimits(target: object): number[] {
  return Reflect.getMetadataKeys(target)
    .filter((k) => typeof k === 'string' && k.startsWith('THROTTLER:LIMIT'))
    .map((k) => Reflect.getMetadata(k, target));
}

function hasSkipThrottle(target: object): boolean {
  return Reflect.getMetadataKeys(target).some(
    (k) =>
      typeof k === 'string' &&
      k.startsWith('THROTTLER:SKIP') &&
      Reflect.getMetadata(k, target) === true,
  );
}

describe('rate limiting metadata', () => {
  it('caps POST /auth/telegram at 30 req/min per IP', () => {
    const limits = throttleLimits(AuthController.prototype.telegramLogin);
    expect(limits).toContain(30);
  });

  it('caps POST /auth/dev-login at 30 req/min per IP', () => {
    const limits = throttleLimits(AuthController.prototype.devLogin);
    expect(limits).toContain(30);
  });

  it('skips the global throttler on the Cryptomus webhook controller', () => {
    expect(hasSkipThrottle(CryptomusWebhookController)).toBe(true);
  });

  it('skips the global throttler on the health controller', () => {
    expect(hasSkipThrottle(HealthController)).toBe(true);
  });
});
