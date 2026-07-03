import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { CommissionRate } from './entities/commission-rate.entity';
import { CurrencyRate } from './entities/currency-rate.entity';
import { ProcessedWebhookEvent } from './entities/processed-webhook-event.entity';
import { Deal } from '../deal/entities/deal.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { CryptomusService } from './cryptomus.service';
import { CryptomusWebhookController } from './cryptomus-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { DealModule } from '../deal/deal.module';
import { UserModule } from '../user/user.module';
import { EscrowModule } from '../escrow/escrow.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { OpsModule } from '../ops/ops.module';
import { CommissionConfigService } from './commission-config.service';
import { FeeConsistencyService } from './fee-consistency.service';
import { WebhookRateLimitGuard } from './webhook-rate-limit.guard';
import { WebhookIpAllowlistGuard } from './webhook-ip-allowlist.guard';
import { CryptomusRail } from './rails/cryptomus.rail';
import { DirectUsdtRail } from './rails/direct-usdt.rail';
import { TonApiService } from './rails/ton-api.service';
import { TonUsdtRail } from './rails/ton-usdt.rail';
import { ToncoinRail } from './rails/toncoin.rail';
import { TonFundingLockService } from './rails/ton-funding-lock.service';
import { TonUnmatchedScanner } from './rails/ton-unmatched.scanner';
import { TonRecoveryService } from './rails/ton-recovery.service';
import { TonUnmatchedDeposit } from './entities/ton-unmatched-deposit.entity';
import { RailRegistryService } from './rails/rail-registry.service';
import { EscrowDeadlineService } from './escrow-deadline.service';
import { DirectDepositWatcher } from './direct-deposit.watcher';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      CommissionRate,
      CurrencyRate,
      Deal,
      TonUnmatchedDeposit,
      ProcessedWebhookEvent,
    ]),
    forwardRef(() => DealModule),
    forwardRef(() => UserModule),
    EscrowModule,
    BlockchainModule,
    OpsModule,
  ],
  controllers: [PaymentController, CryptomusWebhookController],
  providers: [
    PaymentService,
    CryptomusService,
    PaymentWebhookService,
    WebhookIdempotencyService,
    CommissionConfigService,
    FeeConsistencyService,
    WebhookRateLimitGuard,
    WebhookIpAllowlistGuard,
    CryptomusRail,
    DirectUsdtRail,
    TonApiService,
    TonFundingLockService,
    TonUsdtRail,
    ToncoinRail,
    RailRegistryService,
    DirectDepositWatcher,
    TonUnmatchedScanner,
    TonRecoveryService,
    EscrowDeadlineService,
  ],
  exports: [
    PaymentService,
    CryptomusService,
    PaymentWebhookService,
    CommissionConfigService,
    RailRegistryService,
    TonRecoveryService,
    EscrowDeadlineService,
    TonApiService,
    TypeOrmModule,
  ],
})
export class PaymentModule {}
