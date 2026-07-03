import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScammerRecord } from './entities/scammer-record.entity';
import { ScamReport } from './entities/scam-report.entity';
import { AdminProfile } from '../admin/entities/admin-profile.entity';
import { AntiScamConfig } from './anti-scam.config';
import { AntiScamService } from './anti-scam.service';
import { AntiScamPublisherService } from './anti-scam-publisher.service';
import { AntiScamPublishScheduler } from './anti-scam-publish.scheduler';
import { AntiScamAdminController } from './anti-scam-admin.controller';
import { TelegramBotModule } from '../telegram-bot/telegram-bot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScammerRecord, ScamReport, AdminProfile]),
    forwardRef(() => TelegramBotModule),
  ],
  controllers: [AntiScamAdminController],
  providers: [
    AntiScamConfig,
    AntiScamService,
    AntiScamPublisherService,
    AntiScamPublishScheduler,
  ],
  exports: [AntiScamService, AntiScamPublisherService, TypeOrmModule],
})
export class AntiScamModule {}
