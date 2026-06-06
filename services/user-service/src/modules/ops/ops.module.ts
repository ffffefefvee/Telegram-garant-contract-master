import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './entities/outbox-event.entity';
import { AuditLogEntry } from './entities/audit-log.entity';
import { OutboxService } from './outbox.service';
import { AuditLogService } from './audit-log.service';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { Payment } from '../payment/entities/payment.entity';
import { Deal } from '../deal/entities/deal.entity';
import { EscrowModule } from '../escrow/escrow.module';
import { DealModule } from '../deal/deal.module';

/**
 * Operations module — durable side-effects + crash-recovery primitives:
 *
 *  - OutboxService: producers write events transactionally with their
 *    business writes; NotificationWorkerScheduler (NotificationsModule)
 *    delivers them in-process via NotificationDispatcher.
 *  - AuditLogService: append-only log of meaningful state transitions
 *    and admin actions.
 *  - ReconciliationService: re-tries on-chain partials (failed
 *    forwardAndFund, pending arbitrator assignment).
 *  - ReconciliationScheduler: cron driver for the above; toggled by
 *    `RECONCILIATION_ENABLED` env.
 *
 * Imported by AppModule so the cron + DI graph is always available.
 */
@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      OutboxEvent,
      AuditLogEntry,
      Payment,
      Deal,
    ]),
    EscrowModule,
    forwardRef(() => DealModule),
  ],
  providers: [
    OutboxService,
    AuditLogService,
    ReconciliationService,
    ReconciliationScheduler,
  ],
  exports: [OutboxService, AuditLogService, ReconciliationService],
})
export class OpsModule {}
