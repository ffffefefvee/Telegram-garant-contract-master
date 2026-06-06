import { Module } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramTestInjectController } from './telegram-test-inject.controller';
import { TelegramTestInjectService } from './telegram-test-inject.service';
import { TelegramDealHandler } from './telegram-deal.handler';
import { TelegramCallbackHandler } from './telegram-callback.handler';
import { TelegramDealLifecycleHandler } from './telegram-deal-lifecycle.handler';
import { TelegramSessionStore } from './telegram-session.store';
import { UserModule } from '../user/user.module';
import { I18nModule } from '../i18n/i18n.module';
import { DealModule } from '../deal/deal.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [UserModule, I18nModule, DealModule, PaymentModule],
  controllers: [TelegramTestInjectController],
  providers: [
    TelegramSessionStore,
    TelegramBotService,
    TelegramDealHandler,
    TelegramCallbackHandler,
    TelegramDealLifecycleHandler,
    TelegramTestInjectService,
  ],
  exports: [TelegramBotService, TelegramTestInjectService],
})
export class TelegramBotModule {}
