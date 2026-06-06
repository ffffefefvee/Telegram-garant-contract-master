import {
  Injectable,
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';
import {
  validateInitData,
  TelegramInitDataError,
} from './telegram-initdata.validator';

export interface AuthSession {
  /** Compact JWT signed with `JWT_SECRET`. */
  accessToken: string;
  /** Seconds until the token expires. */
  expiresIn: number;
  user: {
    id: string;
    telegramId: number;
    telegramUsername: string | null;
  };
}

export interface JwtPayload {
  /** Internal user UUID (User.id). */
  sub: string;
  /** Telegram numeric ID, denormalised so middleware avoids a DB hit. */
  tg: number;
  /** Issued-at, seconds. */
  iat: number;
  /** Expires, seconds. */
  exp: number;
}

const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Telegram WebApp authentication. Exchanges a freshly-validated `initData`
 * payload for a backend JWT, upserting the User record by Telegram ID.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly tokenTtlSeconds: number;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly users: UserService,
  ) {
    const ttlRaw = this.config.get<string>('AUTH_JWT_TTL_SECONDS', '');
    this.tokenTtlSeconds = ttlRaw ? Number.parseInt(ttlRaw, 10) : DEFAULT_TOKEN_TTL_SECONDS;
  }

  /**
   * Validate Telegram initData against the bot token and issue a JWT.
   * Throws 401 on invalid hash / expired payload.
   * Throws 503 if the bot token isn't configured server-side.
   */
  async loginWithInitData(initData: string): Promise<AuthSession> {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN', '');
    if (!botToken) {
      this.logger.error('TELEGRAM_BOT_TOKEN not configured; cannot validate initData');
      throw new ServiceUnavailableException('Telegram auth not configured');
    }

    let parsed;
    try {
      parsed = validateInitData(initData, botToken);
    } catch (err) {
      if (err instanceof TelegramInitDataError) {
        this.logger.warn(`initData rejected: ${err.code} ${err.message}`);
        throw new UnauthorizedException(`initData rejected: ${err.code}`);
      }
      throw err;
    }

    const tgUser = parsed.user;
    const user = await this.users.updateTelegramUser(
      tgUser.id,
      tgUser.username,
      tgUser.first_name,
      tgUser.last_name,
      tgUser.language_code,
    );

    return this.issueToken(user);
  }

  /**
   * Dev-only login. Skips Telegram initData validation, upserts a User by
   * the supplied telegramId, and issues a JWT. Caller (auth controller) is
   * responsible for env-gating this so it never runs in production.
   */
  async devLogin(opts: {
    telegramId: number;
    username?: string;
    firstName?: string;
    lastName?: string;
    languageCode?: string;
  }): Promise<AuthSession> {
    const user = await this.users.updateTelegramUser(
      opts.telegramId,
      opts.username,
      opts.firstName,
      opts.lastName,
      opts.languageCode,
    );
    return this.issueToken(user);
  }

  /**
   * Build and sign the JWT. Exposed separately so other auth flows (e.g. an
   * admin-impersonation flow added later) can reuse it.
   */
  issueToken(user: User): AuthSession {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      tg: user.telegramId ?? 0,
    };
    const secret = this.requireSecret();
    const accessToken = this.jwt.sign(payload, {
      secret,
      expiresIn: this.tokenTtlSeconds,
    });
    return {
      accessToken,
      expiresIn: this.tokenTtlSeconds,
      user: {
        id: user.id,
        telegramId: user.telegramId ?? 0,
        telegramUsername: user.telegramUsername,
      },
    };
  }

  /**
   * Verify a JWT and return its payload, throwing 401 on any failure.
   * Used by `RequireAuthMiddleware`.
   */
  verifyToken(token: string): JwtPayload {
    const secret = this.requireSecret();
    try {
      return this.jwt.verify<JwtPayload>(token, { secret });
    } catch (err) {
      throw new UnauthorizedException(
        `Invalid token: ${(err as Error).message ?? 'verification failed'}`,
      );
    }
  }

  private requireSecret(): string {
    const secret = this.config.get<string>('JWT_SECRET', '');
    if (!secret) {
      throw new ServiceUnavailableException('JWT_SECRET not configured');
    }
    return secret;
  }
}
