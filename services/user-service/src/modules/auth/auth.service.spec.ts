import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import {
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';

const BOT_TOKEN = '987654321:JEST_BOT_TOKEN';
const JWT_SECRET = 'jest-jwt-secret-keep-this-long-enough-32b';

function buildInitData(opts: { user: object; authDate?: number; tamper?: boolean }): string {
  const fields: Record<string, string> = {
    user: JSON.stringify(opts.user),
    auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  fields.hash = opts.tamper ? '0'.repeat(64) : hash;
  return new URLSearchParams(fields).toString();
}

describe('AuthService', () => {
  let moduleRef: TestingModule;
  let service: AuthService;
  let upsertedUsers: User[];

  beforeAll(async () => {
    upsertedUsers = [];
    const usersStub: Partial<UserService> = {
      updateTelegramUser: jest.fn(async (telegramId: number, username, firstName, lastName, lang) => {
        const u = {
          id: `user-${telegramId}`,
          telegramId,
          telegramUsername: username ?? null,
          telegramFirstName: firstName ?? null,
          telegramLastName: lastName ?? null,
          telegramLanguageCode: lang ?? null,
        } as User;
        upsertedUsers.push(u);
        return u;
      }),
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ TELEGRAM_BOT_TOKEN: BOT_TOKEN, JWT_SECRET })],
        }),
        JwtModule.register({}),
      ],
      providers: [AuthService, { provide: UserService, useValue: usersStub }],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('loginWithInitData', () => {
    it('issues a JWT for a valid initData payload', async () => {
      const data = buildInitData({ user: { id: 42, username: 'alice', first_name: 'Alice' } });
      const session = await service.loginWithInitData(data);
      expect(session.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(session.expiresIn).toBeGreaterThan(0);
      expect(session.user.id).toBe('user-42');
      expect(session.user.telegramId).toBe(42);
      expect(session.user.telegramUsername).toBe('alice');
      expect(upsertedUsers).toHaveLength(1);
    });

    it('rejects a tampered hash', async () => {
      const data = buildInitData({ user: { id: 99 }, tamper: true });
      await expect(service.loginWithInitData(data)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired payload', async () => {
      const data = buildInitData({
        user: { id: 7 },
        authDate: Math.floor(Date.now() / 1000) - 48 * 3600,
      });
      await expect(service.loginWithInitData(data)).rejects.toThrow(/EXPIRED/);
    });

    it('rejects an empty initData', async () => {
      await expect(service.loginWithInitData('')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyToken', () => {
    it('round-trips an issued token', async () => {
      const data = buildInitData({ user: { id: 100, username: 'roundtrip' } });
      const session = await service.loginWithInitData(data);
      const payload = service.verifyToken(session.accessToken);
      expect(payload.sub).toBe('user-100');
      expect(payload.tg).toBe(100);
    });

    it('rejects garbage tokens', () => {
      expect(() => service.verifyToken('not.a.jwt')).toThrow(UnauthorizedException);
    });

    it('rejects tokens signed with a different secret', () => {
      // Manually craft a token with a wrong secret
      const wrongJwt = require('jsonwebtoken').sign(
        { sub: 'user-x', tg: 1 },
        'different-secret',
        { expiresIn: '1h' },
      );
      expect(() => service.verifyToken(wrongJwt)).toThrow(UnauthorizedException);
    });
  });

  describe('devLogin', () => {
    it('upserts user and issues a token without initData', async () => {
      const before = upsertedUsers.length;
      const session = await service.devLogin({
        telegramId: 9001,
        username: 'devuser',
        firstName: 'Dev',
      });
      expect(session.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(session.user.telegramId).toBe(9001);
      expect(session.user.telegramUsername).toBe('devuser');
      expect(upsertedUsers.length).toBe(before + 1);
    });
  });

  describe('configuration guards', () => {
    it('throws 503 when bot token missing', async () => {
      const moduleRef2 = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({ JWT_SECRET })],
          }),
          JwtModule.register({}),
        ],
        providers: [AuthService, { provide: UserService, useValue: { updateTelegramUser: jest.fn() } }],
      }).compile();
      const svc = moduleRef2.get(AuthService);
      await expect(svc.loginWithInitData('whatever')).rejects.toThrow(ServiceUnavailableException);
      await moduleRef2.close();
    });
  });
});
