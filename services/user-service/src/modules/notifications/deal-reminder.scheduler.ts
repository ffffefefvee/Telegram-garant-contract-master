import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Deal } from '../deal/entities/deal.entity';
import { DealStatus } from '../deal/enums/deal.enum';
import { OutboxService } from '../ops/outbox.service';

/** Hours after which an unpaid deal is automatically cancelled (§3 / D6). */
const PAYMENT_EXPIRY_HOURS = 24;

/** Days after which a PENDING_CONFIRMATION deal is auto-confirmed (§3 auto-confirm). */
const AUTO_CONFIRM_DAYS = 3;

/**
 * Reminds parties about unpaid deals, approaching deadlines, and
 * handles FSM timeout transitions (auto-cancel / auto-confirm).
 */
@Injectable()
export class DealReminderScheduler {
  private readonly logger = new Logger(DealReminderScheduler.name);
  private readonly enabled: boolean;

  constructor(
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
    private readonly outbox: OutboxService,
    config: ConfigService,
  ) {
    this.enabled = config.get('DEAL_REMINDERS_ENABLED', 'true') !== 'false';
  }

  /** Send payment reminders for deals unpaid for > 24 h. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'deal.reminders' })
  async remindUnpaidDeals(): Promise<void> {
    if (!this.enabled) return;

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const deals = await this.dealRepo.find({
      where: {
        status: DealStatus.PENDING_PAYMENT,
        updatedAt: LessThan(dayAgo),
      },
      take: 50,
    });

    for (const deal of deals) {
      if (!deal.buyerId) continue;
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.payment_reminder',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? deal.dealNumber,
          buyerUserId: deal.buyerId,
          sellerUserId: deal.sellerId,
        },
      });
    }

    if (deals.length > 0) {
      this.logger.log(`Queued ${deals.length} payment reminders`);
    }
  }

  /**
   * Auto-cancel deals that have been in PENDING_PAYMENT for longer than
   * PAYMENT_EXPIRY_HOURS without receiving a payment (§3 / D6 timeout).
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'deal.payment_expiry' })
  async expireUnpaidDeals(): Promise<void> {
    if (!this.enabled) return;

    const expiryThreshold = new Date(
      Date.now() - PAYMENT_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    const deals = await this.dealRepo.find({
      where: {
        status: DealStatus.PENDING_PAYMENT,
        updatedAt: LessThan(expiryThreshold),
      },
      take: 100,
    });

    for (const deal of deals) {
      if (deal.paidAt) continue; // guard: already paid
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.payment_expired',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? deal.dealNumber,
          buyerUserId: deal.buyerId,
          sellerUserId: deal.sellerId,
        },
      });
    }

    if (deals.length > 0) {
      this.logger.log(`Queued ${deals.length} payment expiry events`);
    }
  }

  /**
   * Auto-confirm deals that have been in PENDING_CONFIRMATION for longer than
   * AUTO_CONFIRM_DAYS without a buyer response (§3 auto-confirm protection).
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'deal.auto_confirm' })
  async autoConfirmStalePendingDeals(): Promise<void> {
    if (!this.enabled) return;

    const autoConfirmThreshold = new Date(
      Date.now() - AUTO_CONFIRM_DAYS * 24 * 60 * 60 * 1000,
    );

    const deals = await this.dealRepo.find({
      where: {
        status: DealStatus.PENDING_CONFIRMATION,
        updatedAt: LessThan(autoConfirmThreshold),
      },
      take: 100,
    });

    for (const deal of deals) {
      await this.outbox.enqueue({
        aggregateType: 'deal',
        aggregateId: deal.id,
        eventType: 'deal.auto_confirmed',
        payload: {
          dealId: deal.id,
          dealTitle: deal.title ?? deal.dealNumber,
          buyerUserId: deal.buyerId,
          sellerUserId: deal.sellerId,
          reason: `Auto-confirmed after ${AUTO_CONFIRM_DAYS} days without buyer response`,
        },
      });
    }

    if (deals.length > 0) {
      this.logger.log(`Queued ${deals.length} auto-confirmation events`);
    }
  }
}
