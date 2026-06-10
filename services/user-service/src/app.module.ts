import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { UserModule } from './modules/user/user.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { TelegramBotModule } from './modules/telegram-bot/telegram-bot.module';
import { User } from './modules/user/entities/user.entity';
import { UserSession } from './modules/user/entities/user-session.entity';
import { LanguagePreference } from './modules/user/entities/language-preference.entity';
import { Deal } from './modules/deal/entities/deal.entity';
import { DealMessage } from './modules/deal/entities/deal-message.entity';
import { DealAttachment } from './modules/deal/entities/deal-attachment.entity';
import { DealInvite } from './modules/deal/entities/deal-invite.entity';
import { DealEvent } from './modules/deal/entities/deal-event.entity';
import { DealModule } from './modules/deal/deal.module';
import { Payment } from './modules/payment/entities/payment.entity';
import { CommissionRate } from './modules/payment/entities/commission-rate.entity';
import { CurrencyRate } from './modules/payment/entities/currency-rate.entity';
import { PaymentModule } from './modules/payment/payment.module';
import { Review } from './modules/review/entities/review.entity';
import { ReputationScore } from './modules/review/entities/reputation-score.entity';
import { ReviewModule } from './modules/review/review.module';
import { ArbitrationModule } from './modules/arbitration/arbitration.module';
import { AuthModule } from './modules/auth/auth.module';
import { EscrowModule } from './modules/escrow/escrow.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { AdminModule } from './modules/admin/admin.module';
import {
  Dispute,
  Evidence,
  ArbitrationChat,
  ArbitrationChatMessage,
  ArbitrationDecision,
  ArbitrationEvent,
  Appeal,
  DealTerms,
  ArbitrationSettings,
  ArbitratorProfile,
} from './modules/arbitration/entities';
import { StoreModule } from './modules/store/store.module';
import { Store, StoreBot, StoreSettings, StoreTemplate } from './modules/store/entities/store.entity';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { OpsModule } from './modules/ops/ops.module';
import { OutboxEvent } from './modules/ops/entities/outbox-event.entity';
import { AuditLogEntry } from './modules/ops/entities/audit-log.entity';
import { AdminLog } from './modules/admin/entities/admin-log.entity';
import { AdminProfile } from './modules/admin/entities/admin-profile.entity';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { NotificationPreference } from './modules/notifications/entities/notification-preference.entity';
import {
  SystemAlert,
  HealthCheck,
  SystemMetrics,
  RecoveryLog,
  JobSchedule,
} from './modules/monitoring/entities/monitoring.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const useSqlite = configService.get('DB_USE_SQLITE') === 'true';
        
        if (useSqlite) {
          return {
            type: 'sqlite',
            database: ':memory:',
            entities: [
              User,
              UserSession,
              LanguagePreference,
              Deal,
              DealMessage,
              DealAttachment,
              DealInvite,
              DealEvent,
              Payment,
              CommissionRate,
              CurrencyRate,
              Review,
              ReputationScore,
              Dispute,
              Evidence,
              ArbitrationChat,
              ArbitrationChatMessage,
              ArbitrationDecision,
              ArbitrationEvent,
              Appeal,
              DealTerms,
              ArbitrationSettings,
              ArbitratorProfile,
              Store,
              StoreBot,
              StoreSettings,
              StoreTemplate,
              SystemAlert,
              HealthCheck,
              SystemMetrics,
              RecoveryLog,
              JobSchedule,
              NotificationPreference,
              OutboxEvent,
              AuditLogEntry,
              AdminLog,
              AdminProfile,
            ],
synchronize: true,
            logging: configService.get('NODE_ENV') === 'development',
          };
        }
        
        return {
          type: 'postgres',
          host: configService.get('DB_HOST', 'localhost'),
          port: configService.get('DB_PORT', 5432),
          username: configService.get('DB_USERNAME', 'garant_user'),
          password: configService.get('DB_PASSWORD', 'garant_pass'),
          database: configService.get('DB_NAME', 'garant_db'),
          entities: [
            User,
            UserSession,
            LanguagePreference,
            Deal,
            DealMessage,
            DealAttachment,
            DealInvite,
            DealEvent,
            Payment,
            CommissionRate,
            CurrencyRate,
            Review,
            ReputationScore,
            Dispute,
            Evidence,
            ArbitrationChat,
            ArbitrationChatMessage,
            ArbitrationDecision,
            ArbitrationEvent,
            Appeal,
            DealTerms,
            ArbitrationSettings,
            ArbitratorProfile,
            Store,
            StoreBot,
            StoreSettings,
            StoreTemplate,
            SystemAlert,
            HealthCheck,
            SystemMetrics,
            RecoveryLog,
            JobSchedule,
            NotificationPreference,
            OutboxEvent,
            AuditLogEntry,
            AdminLog,
            AdminProfile,
          ],
          migrations: [__dirname + '/../migrations/*{.ts,.js}'],
          // synchronize lets TypeORM mutate the schema on boot. Convenient in
          // dev, destructive in production (can drop/alter columns under
          // load). Default ON only outside production; in production it must
          // be explicitly opted into via DB_SYNCHRONIZE=true (use migrations
          // + DB_MIGRATIONS_RUN=true instead).
          synchronize:
            configService.get(
              'DB_SYNCHRONIZE',
              configService.get('NODE_ENV') === 'production' ? 'false' : 'true',
            ) === 'true',
          logging: configService.get('NODE_ENV') === 'development',
          migrationsRun: configService.get('DB_MIGRATIONS_RUN', 'false') === 'true',
          retryAttempts: 3,
          retryDelay: 1000,
        };
      },
      inject: [ConfigService],
    }),

    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const useSqlite = configService.get('DB_USE_SQLITE') === 'true';
        
        if (useSqlite) {
          return {
            type: 'single',
            url: 'redis://localhost:6379',
            lazyConnect: true,
            onClientCreated: () => {
              console.log('[Redis] Running without Redis (SQLite mode)');
            },
          };
        }
        
        return {
          type: 'single',
          url: `redis://:${configService.get('REDIS_PASSWORD')}@${configService.get('REDIS_HOST', 'localhost')}:${configService.get('REDIS_PORT', 6379)}`,
        };
      },
      inject: [ConfigService],
    }),

    UserModule,
    I18nModule,
    TelegramBotModule,
    DealModule,
    PaymentModule,
    ReviewModule,
    ArbitrationModule,
    AuthModule,
    EscrowModule,
    BlockchainModule,
    AdminModule,
    StoreModule,
    MonitoringModule,
    OpsModule,
    NotificationsModule,
  ],
  exports: [
    AdminModule,
  ],
})
export class AppModule {}
