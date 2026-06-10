import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody is required to verify Cryptomus webhook signatures against the
  // exact bytes Cryptomus hashed (see CryptomusService.verifySignature).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.useWebSocketAdapter(new IoAdapter(app));

  const configService = app.get(ConfigService);

  // Security headers. API-only service, so the default CSP is fine.
  app.use(helmet());

  // Real client IPs behind nginx/Railway (rate limiting keys off req.ip).
  app.set('trust proxy', 1);

  // CORS: `credentials: true` together with a wildcard origin is rejected by
  // browsers and would silently break cookie/credentialed requests. Only send
  // credentials when an explicit origin allow-list is configured.
  const corsOrigin = configService.get('CORS_ORIGIN', '*');
  app.enableCors({
    origin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o: string) => o.trim()),
    credentials: corsOrigin !== '*',
  });

  // Graceful shutdown: lets TypeORM/Redis/outbox cron close cleanly on
  // SIGTERM (docker-compose stop, Railway redeploys).
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.setGlobalPrefix('api');

  const port = configService.get('USER_SERVICE_PORT', 3001);

  await app.listen(port);

  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   Telegram Guarantee Bot - User Service                   ║
  ║                                                           ║
  ║   Server running on port: ${port}                          ║
  ║   Environment: ${configService.get('NODE_ENV', 'development')}                              ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `);
}

bootstrap();
