import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService, AuthSession } from './auth.service';

// NOTE: Defined as `interface` (not `class`) on purpose. The global
// ValidationPipe in main.ts uses `forbidNonWhitelisted: true`, which rejects
// every property of a class-typed @Body() payload that doesn't carry a
// class-validator decorator. The rest of the codebase intentionally uses
// interfaces for @Body DTOs so requests pass through untouched. Switching
// these to classes (without adding decorators) silently breaks the endpoint
// at runtime — all properties fail validation. Keep them as interfaces.
export interface TelegramLoginDto {
  /** Raw `window.Telegram.WebApp.initData` string (URL-encoded form-data). */
  initData: string;
}

export interface DevLoginDto {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /api/auth/telegram
   *
   * Body: { initData: string }
   *
   * Validates the Telegram WebApp `initData` payload, upserts the User by
   * Telegram ID, and returns a signed JWT to use as the Bearer token for
   * subsequent requests.
   */
  // Stricter than the global limit: login is the brute-force surface
  // (forged initData / JWT fishing). 30/min per IP — strict enough against
  // scripted abuse, loose enough for mobile users behind carrier NAT who
  // share an exit IP.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('telegram')
  @HttpCode(200)
  async telegramLogin(@Body() body: TelegramLoginDto): Promise<AuthSession> {
    return this.auth.loginWithInitData(body?.initData ?? '');
  }

  /**
   * POST /api/auth/dev-login (DEV ONLY)
   *
   * Bypasses Telegram initData validation for local e2e smoke tests and
   * mini-app dev-mode work. Gated by `AUTH_DEV_MODE=true` AND
   * `NODE_ENV !== 'production'`. Returns 403 in any other environment.
   *
   * Body: { telegramId, username?, firstName?, lastName?, languageCode? }
   */
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(@Body() body: DevLoginDto): Promise<AuthSession> {
    const enabled = this.config.get<string>('AUTH_DEV_MODE', '') === 'true';
    const env = this.config.get<string>('NODE_ENV', 'development');
    if (!enabled || env === 'production') {
      throw new ForbiddenException(
        'dev-login is disabled (set AUTH_DEV_MODE=true and NODE_ENV != production)',
      );
    }
    if (typeof body?.telegramId !== 'number' || !Number.isFinite(body.telegramId)) {
      throw new ForbiddenException('telegramId is required and must be numeric');
    }
    return this.auth.devLogin({
      telegramId: body.telegramId,
      username: body.username,
      firstName: body.firstName,
      lastName: body.lastName,
      languageCode: body.languageCode,
    });
  }
}
