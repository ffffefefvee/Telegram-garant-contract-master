import {
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RequireAuthMiddleware } from './auth.middleware';

/**
 * Auth module. Provides:
 *   - POST /api/auth/telegram — exchange Telegram WebApp initData for a JWT
 *   - RequireAuthMiddleware — enforces Bearer JWT on all protected routes
 *
 * Public routes (excluded below) include:
 *   - GET /health, GET /ping (liveness/readiness)
 *   - POST /auth/telegram (login itself can't require auth)
 *   - Webhook endpoints under /webhook/* (HMAC-verified per provider)
 */
@Module({
  imports: [
    ConfigModule,
    UserModule,
    // JwtModule registered without a static secret — AuthService reads
    // JWT_SECRET from ConfigService at sign/verify time. This keeps secrets
    // out of module decorators and makes runtime rotation possible.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, RequireAuthMiddleware],
  exports: [AuthService, RequireAuthMiddleware],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequireAuthMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'ping', method: RequestMethod.GET },
        { path: 'auth/telegram', method: RequestMethod.POST },
        { path: 'auth/dev-login', method: RequestMethod.POST },
        { path: 'internal/telegram/test/command', method: RequestMethod.POST },
        { path: 'internal/telegram/test/callback', method: RequestMethod.POST },
        { path: 'internal/telegram/test/update', method: RequestMethod.POST },
        { path: 'webhook/(.*)', method: RequestMethod.POST },
        { path: 'metrics', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
