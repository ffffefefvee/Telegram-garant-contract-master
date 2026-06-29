import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cryptomus webhooks carry no nonce or timestamp, so a captured `paid` body
 * can be replayed verbatim with a still-valid signature. Two layers defend
 * against that:
 *   1. The business effect is idempotent (WebhookIdempotencyService) — a
 *      replay never moves money twice.
 *   2. This guard restricts WHO may reach the endpoint to Cryptomus' source
 *      IP(s), the verification Cryptomus officially recommends alongside the
 *      signature check.
 *
 * Cryptomus sends webhooks from a fixed IP (documented as 91.227.144.54).
 * Configure the allow-list via `CRYPTOMUS_WEBHOOK_IP_ALLOWLIST` (comma-
 * separated). When unset the guard is a no-op (logged once) so local/sandbox
 * testing through ngrok — where the source IP differs — keeps working.
 *
 * Requires `trust proxy` (set in main.ts) so `req.ip` is the real client IP
 * behind nginx/Railway rather than the proxy address.
 */
@Injectable()
export class WebhookIpAllowlistGuard implements CanActivate {
  private readonly logger = new Logger(WebhookIpAllowlistGuard.name);
  private readonly allowlist: Set<string>;
  private warnedDisabled = false;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>(
      'CRYPTOMUS_WEBHOOK_IP_ALLOWLIST',
      '',
    );
    this.allowlist = new Set(
      raw
        .split(',')
        .map((ip) => this.normalizeIp(ip.trim()))
        .filter((ip) => ip.length > 0),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    // No allow-list configured → don't block (dev/sandbox via ngrok). Warn
    // once so the gap is visible in logs without spamming on every webhook.
    if (this.allowlist.size === 0) {
      if (!this.warnedDisabled) {
        this.logger.warn(
          'CRYPTOMUS_WEBHOOK_IP_ALLOWLIST is not set — webhook source IP is not enforced',
        );
        this.warnedDisabled = true;
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<{ ip?: string }>();
    const clientIp = this.normalizeIp(req?.ip ?? '');
    if (!clientIp || !this.allowlist.has(clientIp)) {
      this.logger.error(
        `Rejected webhook from non-allowlisted IP: ${clientIp || 'unknown'}`,
      );
      throw new ForbiddenException('Webhook source not allowed');
    }
    return true;
  }

  /** Strip the IPv4-mapped IPv6 prefix so `::ffff:1.2.3.4` matches `1.2.3.4`. */
  private normalizeIp(ip: string): string {
    return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  }
}
