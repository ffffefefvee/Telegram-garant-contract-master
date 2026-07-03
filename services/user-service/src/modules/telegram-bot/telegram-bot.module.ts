import { forwardRef, Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramTestInjectController } from './telegram-test-inject.controller';
import { TelegramTestInjectService } from './telegram-test-inject.service';
import { TelegramDealHandler } from './telegram-deal.handler';
import { TelegramCallbackHandler } from './telegram-callback.handler';
import { TelegramDealLifecycleHandler } from './telegram-deal-lifecycle.handler';
import { TelegramAntiScamHandler } from './telegram-anti-scam.handler';
import { TelegramSessionStore } from './telegram-session.store';
import { UserModule } from '../user/user.module';
import { I18nModule } from '../i18n/i18n.module';
import { DealModule } from '../deal/deal.module';
import { PaymentModule } from '../payment/payment.module';
import { AntiScamModule } from '../anti-scam/anti-scam.module';

@Module({
  imports: [
    UserModule,
    I18nModule,
    DealModule,
    PaymentModule,
    forwardRef(() => AntiScamModule),
  ],
  controllers: [TelegramTestInjectController],
  providers: [
    TelegramSessionStore,
    TelegramBotService,
    TelegramDealHandler,
    TelegramCallbackHandler,
    TelegramDealLifecycleHandler,
    TelegramAntiScamHandler,
    TelegramTestInjectService,
  ],
  exports: [TelegramBotService, TelegramTestInjectService],
})
export class TelegramBotModule {}
