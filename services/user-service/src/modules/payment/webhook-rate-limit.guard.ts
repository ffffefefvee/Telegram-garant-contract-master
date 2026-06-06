import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

/** In-memory rate limit: 100 requests / minute per IP (Cryptomus webhook). */
@Injectable()
export class WebhookRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly limit = 100;
  private readonly windowMs = 60_000;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ ip?: string }>();
    const key = req.ip ?? 'global';
    const now = Date.now();
    const window = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (window.length >= this.limit) {
      throw new HttpException('Webhook rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    window.push(now);
    this.hits.set(key, window);
    return true;
  }
}
