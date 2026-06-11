import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { TonUnmatchedDeposit } from '../entities/ton-unmatched-deposit.entity';
import { PaymentMethod, PaymentStatus } from '../enums/payment.enum';
import { TonApiService, TonIncomingTransfer } from './ton-api.service';

/** Payment statuses that legitimately consume an incoming transfer. */
const ACCEPTING_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.COMPLETED,
]);

export interface ScanReport {
  scanned: number;
  matched: number;
  newUnmatched: number;
  alreadyKnown: number;
}

/**
 * Safety net for the TON rail: every incoming USDT-TON transfer to the
 * platform wallet must be attributable to a payment. Transfers whose
 * comment matches no live memo (forgotten memo, typo, or a memo of an
 * already-expired payment) are recorded in the `ton_unmatched_deposits`
 * ledger instead of being silently ignored — for an escrow service this
 * is customer money in limbo.
 *
 * Runs every 5 minutes over a sliding lookback window (default 24h);
 * idempotent via the (eventId, actionIndex) unique key. Recorded rows are
 * resolved manually by admins through `TonRecoveryService`.
 *
 * Config:
 *  - TON_UNMATCHED_SCANNER_ENABLED  default true
 *  - TON_UNMATCHED_LOOKBACK_HOURS   default 24
 */
@Injectable()
export class TonUnmatchedScanner implements OnModuleInit {
  private readonly logger = new Logger(TonUnmatchedScanner.name);
  private running = false;
  private enabled = true;
  private lookbackHours: number;

  constructor(
    private readonly tonApi: TonApiService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(TonUnmatchedDeposit)
    private readonly unmatchedRepo: Repository<TonUnmatchedDeposit>,
  ) {
    this.lookbackHours = Number(
      this.config.get<string>('TON_UNMATCHED_LOOKBACK_HOURS', '24'),
    );
  }

  onModuleInit(): void {
    this.enabled =
      this.config.get<string>('TON_UNMATCHED_SCANNER_ENABLED', 'true') !==
      'false';
    if (!this.enabled) {
      try {
        this.registry.deleteCronJob('ton-unmatched.scan');
      } catch {
        // not yet registered — safe to ignore
      }
      this.logger.log(
        'TON unmatched-deposit scanner disabled (TON_UNMATCHED_SCANNER_ENABLED=false)',
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'ton-unmatched.scan' })
  async tick(): Promise<void> {
    if (!this.enabled || this.running) return;
    if (!this.tonApi.isEnabled()) return; // TON wallet not configured
    this.running = true;
    try {
      const report = await this.runOnce();
      if (report.newUnmatched > 0) {
        this.logger.warn(
          `TON scan: ${report.newUnmatched} NEW unmatched deposit(s) recorded ` +
            `(scanned=${report.scanned} matched=${report.matched})`,
        );
      }
    } catch (err) {
      this.logger.error(`TON unmatched scan failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** One full pass; exposed for tests and manual admin triggering. */
  async runOnce(): Promise<ScanReport> {
    const sinceUnix =
      Math.floor(Date.now() / 1000) - this.lookbackHours * 3600;
    const transfers = await this.tonApi.listIncomingUsdtTransfers(sinceUnix);
    if (transfers.length === 0) {
      return { scanned: 0, matched: 0, newUnmatched: 0, alreadyKnown: 0 };
    }

    const memoMap = await this.loadMemoMap();
    let matched = 0;
    let newUnmatched = 0;
    let alreadyKnown = 0;

    for (const transfer of transfers) {
      const claim = transfer.comment ? memoMap.get(transfer.comment) : undefined;
      if (claim && ACCEPTING_STATUSES.has(claim.status)) {
        matched += 1; // the rail's own memo matching handles/handled it
        continue;
      }

      const existing = await this.unmatchedRepo.findOne({
        where: { eventId: transfer.eventId, actionIndex: transfer.actionIndex },
      });
      if (existing) {
        alreadyKnown += 1;
        continue;
      }

      await this.unmatchedRepo.save(this.toRow(transfer, claim?.paymentId));
      newUnmatched += 1;
      this.logger.warn(
        `Unmatched TON deposit recorded: event=${transfer.eventId} ` +
          `amountUnits=${transfer.amountUnits} comment="${transfer.comment}"` +
          (claim ? ` (memo of non-accepting payment ${claim.paymentId})` : ''),
      );
    }

    return { scanned: transfers.length, matched, newUnmatched, alreadyKnown };
  }

  /**
   * memo → payment for recent TON payments. Loaded into memory (memos live
   * in a JSON column, so SQL-side matching would not be portable between
   * postgres and the sqlite dev mode); recent TON payment volume is small.
   */
  private async loadMemoMap(): Promise<
    Map<string, { paymentId: string; status: PaymentStatus }>
  > {
    const horizon = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const payments = await this.paymentRepo.find({
      where: {
        paymentMethod: PaymentMethod.CRYPTO_TON,
        createdAt: MoreThan(horizon),
      },
      order: { createdAt: 'DESC' },
      take: 1000,
    });

    const map = new Map<string, { paymentId: string; status: PaymentStatus }>();
    for (const payment of payments) {
      const memo = (payment.metadata?.memo as string) ?? '';
      if (!memo) continue;
      const known = map.get(memo);
      // Prefer a payment that can still accept funds over an expired one.
      if (!known || ACCEPTING_STATUSES.has(payment.status)) {
        map.set(memo, { paymentId: payment.id, status: payment.status });
      }
    }
    return map;
  }

  private toRow(
    transfer: TonIncomingTransfer,
    paymentHintId?: string,
  ): Partial<TonUnmatchedDeposit> {
    return {
      eventId: transfer.eventId,
      actionIndex: transfer.actionIndex,
      txTimestamp: transfer.timestamp,
      senderAddress: transfer.sender,
      amountUnits: transfer.amountUnits.toString(),
      comment: transfer.comment || null,
      status: 'unmatched',
      paymentHintId: paymentHintId ?? null,
    };
  }
}
