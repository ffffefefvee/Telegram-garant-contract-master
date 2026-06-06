import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitoringService } from './monitoring.service';
import {
  SystemAlert,
  HealthCheck,
  SystemMetrics,
  RecoveryLog,
  JobSchedule,
} from './entities/monitoring.entity';
import { DealModule } from '../deal/deal.module';
import { PaymentModule } from '../payment/payment.module';
import { Deal } from '../deal/entities/deal.entity';
import { Payment } from '../payment/entities/payment.entity';
import { OpsModule } from '../ops/ops.module';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SystemAlert,
      HealthCheck,
      SystemMetrics,
      RecoveryLog,
      JobSchedule,
      Deal,
      Payment,
    ]),
    forwardRef(() => DealModule),
    forwardRef(() => PaymentModule),
    OpsModule,
    forwardRef(() => TelegramBotModule),
    BlockchainModule,
  ],
  controllers: [MetricsController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}