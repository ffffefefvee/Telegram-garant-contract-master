import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { Store, StoreBot, StoreSettings, StoreTemplate } from './entities/store.entity';
import { UserModule } from '../user/user.module';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store, StoreBot, StoreSettings, StoreTemplate]),
    UserModule,
    forwardRef(() => TelegramBotModule),
  ],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}