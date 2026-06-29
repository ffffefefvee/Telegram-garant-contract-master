import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookIpAllowlistGuard } from './webhook-ip-allowlist.guard';

function makeConfig(allowlist: string): ConfigService {
  return {
    get: jest.fn((key: string, def?: string) =>
      key === 'CRYPTOMUS_WEBHOOK_IP_ALLOWLIST' ? allowlist : def,
    ),
  } as unknown as ConfigService;
}

function makeContext(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

describe('WebhookIpAllowlistGuard', () => {
  it('allows any IP when the allow-list is not configured (no-op)', () => {
    const guard = new WebhookIpAllowlistGuard(makeConfig(''));
    expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
  });

  it('allows a whitelisted Cryptomus IP', () => {
    const guard = new WebhookIpAllowlistGuard(makeConfig('91.227.144.54'));
    expect(guard.canActivate(makeContext('91.227.144.54'))).toBe(true);
  });

  it('rejects a non-whitelisted IP', () => {
    const guard = new WebhookIpAllowlistGuard(makeConfig('91.227.144.54'));
    expect(() => guard.canActivate(makeContext('5.6.7.8'))).toThrow(
      ForbiddenException,
    );
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    const guard = new WebhookIpAllowlistGuard(makeConfig('91.227.144.54'));
    expect(guard.canActivate(makeContext('::ffff:91.227.144.54'))).toBe(true);
  });

  it('supports multiple comma-separated IPs with surrounding spaces', () => {
    const guard = new WebhookIpAllowlistGuard(
      makeConfig('91.227.144.54, 10.0.0.1'),
    );
    expect(guard.canActivate(makeContext('10.0.0.1'))).toBe(true);
    expect(() => guard.canActivate(makeContext('10.0.0.2'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the client IP is missing and a list is configured', () => {
    const guard = new WebhookIpAllowlistGuard(makeConfig('91.227.144.54'));
    expect(() => guard.canActivate(makeContext(''))).toThrow(
      ForbiddenException,
    );
  });
});
