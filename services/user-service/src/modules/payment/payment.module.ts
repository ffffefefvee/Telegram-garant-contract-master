import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { CommissionRate } from './entities/commission-rate.entity';
import { CurrencyRate } from './entities/currency-rate.entity';
import { Deal } from '../deal/entities/deal.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { CryptomusService } from './cryptomus.service';
import { CryptomusWebhookController } from './cryptomus-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { DealModule } from '../deal/deal.module';
import { UserModule } from '../user/user.module';
import { EscrowModule } from '../escrow/escrow.module';
import { OpsModule } from '../ops/ops.module';
import { CommissionConfigService } from './commission-config.service';
import { WebhookRateLimitGuard } from './webhook-rate-limit.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, CommissionRate, CurrencyRate, Deal]),
    forwardRef(() => DealModule),
    forwardRef(() => UserModule),
    EscrowModule,
    OpsModule,
  ],
  controllers: [PaymentController, CryptomusWebhookController],
  providers: [
    PaymentService,
    CryptomusService,
    PaymentWebhookService,
    CommissionConfigService,
    WebhookRateLimitGuard,
  ],
  exports: [
    PaymentService,
    CryptomusService,
    PaymentWebhookService,
    CommissionConfigService,
    TypeOrmModule,
  ],
})
export class PaymentModule {}
