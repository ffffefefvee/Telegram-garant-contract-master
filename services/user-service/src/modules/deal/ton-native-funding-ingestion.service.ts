import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, IsNull, Repository } from "typeorm";
import { MoneyLedgerService } from "../ops/money-ledger.service";
import { DealStatus } from "./enums/deal.enum";
import { Deal } from "./entities/deal.entity";
import {
  TonNativeChainEvent,
  TonNativeChainEventOutcome,
} from "./entities/ton-native-chain-event.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import {
  TonNativeEscrowWatch,
  TonNativeEscrowWatchStatus,
} from "./entities/ton-native-escrow-watch.entity";
import { DealService } from "./deal.service";
import {
  TonCenterTransaction,
  TonCenterV3Service,
  validateTonNativeFundingTransaction,
} from "./ton-center-v3.service";
import { TonNativeEventApplyLockService } from "./ton-native-event-apply-lock.service";
import {
  TonNativeReconciliationError,
  TonNativeReconciliationService,
} from "./ton-native-reconciliation.service";

const MAX_WATCHES_PER_RUN = 100;
const MAX_PAGES_PER_WATCH = 10;
const PAGE_SIZE = 100;
const APPLY_FAILURES_BEFORE_REVIEW = 5;

export interface TonNativeIngestionReport {
  watchesCreated: number;
  watchesScanned: number;
  transactionsObserved: number;
  accepted: number;
  rejected: number;
  applied: number;
  applyFailed: number;
}

/** Replay-safe finalized funding recognition and business-state application. */
@Injectable()
export class TonNativeFundingIngestionService {
  private readonly logger = new Logger(TonNativeFundingIngestionService.name);

  constructor(
    private readonly tonCenter: TonCenterV3Service,
    private readonly dealService: DealService,
    private readonly ledger: MoneyLedgerService,
    @InjectRepository(TonNativeEscrowPreparation)
    private readonly preparationRepo: Repository<TonNativeEscrowPreparation>,
    @InjectRepository(TonNativeEscrowWatch)
    private readonly watchRepo: Repository<TonNativeEscrowWatch>,
    @InjectRepository(TonNativeChainEvent)
    private readonly eventRepo: Repository<TonNativeChainEvent>,
    private readonly applyLock: TonNativeEventApplyLockService,
    private readonly reconciliation: TonNativeReconciliationService,
  ) {}

  isEnabled(): boolean {
    return this.tonCenter.isEnabled();
  }

  async runOnce(): Promise<TonNativeIngestionReport> {
    const report: TonNativeIngestionReport = {
      watchesCreated: 0,
      watchesScanned: 0,
      transactionsObserved: 0,
      accepted: 0,
      rejected: 0,
      applied: 0,
      applyFailed: 0,
    };

    await this.applyPendingEvents(report);
    report.watchesCreated = await this.ensureWatches();
    const watches = await this.watchRepo.find({
      where: { status: TonNativeEscrowWatchStatus.WATCHING },
      relations: ["preparation"],
      order: { createdAt: "ASC" },
      take: MAX_WATCHES_PER_RUN,
    });

    for (const watch of watches) {
      try {
        const pageLimitReached = await this.scanWatch(
          watch,
          report,
          MAX_PAGES_PER_WATCH,
        );
        if (pageLimitReached) {
          throw new Error(
            "Native TON scan page limit reached; operator backfill required",
          );
        }
        await this.watchRepo.update(
          { id: watch.id },
          {
            consecutiveFailures: 0,
            lastError: null,
            lastScannedAt: new Date(),
          },
        );
        report.watchesScanned += 1;
      } catch (err) {
        const lastError = errorMessage(err);
        await this.watchRepo.update(
          { id: watch.id },
          {
            consecutiveFailures: () => '"consecutiveFailures" + 1',
            lastError,
            lastScannedAt: new Date(),
          },
        );
        this.logger.warn(`Native TON watch ${watch.id} failed: ${lastError}`);
      }
    }
    return report;
  }

  async backfillWatch(watchId: string, maxPages: number) {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException("Native TON ingestion is disabled");
    }
    const watch = await this.watchRepo.findOne({
      where: { id: watchId },
      relations: ["preparation"],
    });
    if (!watch) throw new ConflictException("Native TON watch not found");
    if (watch.status !== TonNativeEscrowWatchStatus.WATCHING) {
      throw new ConflictException("Watch is not awaiting native TON funding");
    }
    const report: TonNativeIngestionReport = {
      watchesCreated: 0,
      watchesScanned: 0,
      transactionsObserved: 0,
      accepted: 0,
      rejected: 0,
      applied: 0,
      applyFailed: 0,
    };
    const pageLimitReached = await this.scanWatch(watch, report, maxPages);
    await this.watchRepo.update(
      { id: watch.id },
      {
        lastScannedAt: new Date(),
        consecutiveFailures: 0,
        lastError: pageLimitReached ? "BACKFILL_MORE_PAGES_AVAILABLE" : null,
      },
    );
    report.watchesScanned = 1;
    return { ...report, pageLimitReached };
  }

  private async ensureWatches(): Promise<number> {
    const preparations = await this.preparationRepo
      .createQueryBuilder("preparation")
      .leftJoin(
        TonNativeEscrowWatch,
        "watch",
        "watch.preparationId = preparation.id",
      )
      .innerJoin(Deal, "deal", "deal.id = preparation.dealId")
      .where("watch.id IS NULL")
      .andWhere("deal.status = :status", { status: DealStatus.PENDING_PAYMENT })
      .orderBy("preparation.createdAt", "ASC")
      .take(MAX_WATCHES_PER_RUN)
      .getMany();
    let created = 0;
    for (const preparation of preparations) {
      try {
        await this.watchRepo.save(
          this.watchRepo.create({
            preparationId: preparation.id,
            dealId: preparation.dealId,
            network: preparation.network,
            accountAddress: preparation.escrowAddress,
            status: TonNativeEscrowWatchStatus.WATCHING,
            lastFinalizedLt: null,
            lastFinalizedTxHash: null,
            lastFinalizedMcSeqno: null,
            lastScannedAt: null,
            consecutiveFailures: 0,
            lastError: null,
          }),
        );
        created += 1;
      } catch (err) {
        if (!/unique/i.test(errorMessage(err))) throw err;
      }
    }
    return created;
  }

  private async scanWatch(
    watch: TonNativeEscrowWatch,
    report: TonNativeIngestionReport,
    maxPages: number,
  ): Promise<boolean> {
    const preparation = watch.preparation;
    if (!preparation) throw new Error("Watch preparation was not loaded");
    let startLt = watch.lastFinalizedLt
      ? (BigInt(watch.lastFinalizedLt) + 1n).toString()
      : undefined;
    const startUtime = Math.max(
      0,
      Math.floor(preparation.createdAt.getTime() / 1_000) - 60,
    );

    for (let page = 0; page < maxPages; page += 1) {
      const transactions = await this.tonCenter.listFinalizedTransactions({
        network: preparation.network,
        account: preparation.escrowAddress,
        startUtime,
        startLt,
      });
      transactions.sort((a, b) => compareLt(a.lt, b.lt));
      for (const transaction of transactions) {
        const event = await this.observeTransaction(
          watch,
          preparation,
          transaction,
        );
        report.transactionsObserved += 1;
        if (event.outcome === TonNativeChainEventOutcome.ACCEPTED) {
          report.accepted += 1;
          this.recordApplyResult(await this.applyEvent(event), report);
          // A valid Fund is terminal for this watcher. Later lifecycle
          // transactions are handled by their own settlement indexer.
          return false;
        } else {
          report.rejected += 1;
        }
        startLt = (BigInt(event.transactionLt) + 1n).toString();
      }
      if (transactions.length < PAGE_SIZE) return false;
    }
    return true;
  }

  private async observeTransaction(
    watch: TonNativeEscrowWatch,
    preparation: TonNativeEscrowPreparation,
    transaction: TonCenterTransaction,
  ): Promise<TonNativeChainEvent> {
    const validation = validateTonNativeFundingTransaction(
      transaction,
      preparation,
    );
    if (
      !validation.accountAddress ||
      !validation.transactionLt ||
      !/^\d+$/.test(validation.transactionLt) ||
      !validation.transactionHash ||
      !validation.masterchainSeqno ||
      !validation.transactionTime
    ) {
      throw new Error(
        "TON Center returned a transaction without a durable identity",
      );
    }

    let event = await this.eventRepo.findOne({
      where: {
        network: preparation.network,
        accountAddress: validation.accountAddress,
        transactionLt: validation.transactionLt,
        transactionHash: validation.transactionHash,
      },
    });
    if (!event) {
      const candidate = this.eventRepo.create({
        preparationId: preparation.id,
        dealId: preparation.dealId,
        eventType: "fund",
        intentId: null,
        network: preparation.network,
        accountAddress: validation.accountAddress,
        transactionLt: validation.transactionLt,
        transactionHash: validation.transactionHash,
        masterchainSeqno: validation.masterchainSeqno,
        transactionTime: validation.transactionTime,
        messageHash: validation.messageHash,
        sourceAddress: validation.sourceAddress,
        valueAtomic: validation.valueAtomic,
        payloadHash: validation.payloadHash,
        postCodeHash: validation.postCodeHash,
        postConfigHash: validation.postConfigHash,
        postStateHash: validation.postStateHash,
        postDataHash: validation.postDataHash,
        reconciledAt: null,
        reconciliationSource: null,
        reconciliationEvidence: null,
        reconciliationError: null,
        outcome: validation.accepted
          ? TonNativeChainEventOutcome.ACCEPTED
          : TonNativeChainEventOutcome.REJECTED,
        reasonCode: validation.reasonCode,
        evidence: validation.evidence,
        applyAttempts: 0,
        appliedAt: null,
        automationStoppedAt: null,
        lastApplyError: null,
      });
      try {
        event = await this.eventRepo.save(candidate);
      } catch (err) {
        if (!/unique/i.test(errorMessage(err))) throw err;
        event = await this.eventRepo.findOne({
          where: {
            network: preparation.network,
            accountAddress: validation.accountAddress,
            transactionLt: validation.transactionLt,
            transactionHash: validation.transactionHash,
          },
        });
        if (!event) throw err;
      }
    }

    const current = await this.watchRepo.findOneOrFail({
      where: { id: watch.id },
    });
    if (
      !current.lastFinalizedLt ||
      BigInt(validation.transactionLt) > BigInt(current.lastFinalizedLt)
    ) {
      current.lastFinalizedLt = validation.transactionLt;
      current.lastFinalizedTxHash = validation.transactionHash;
      current.lastFinalizedMcSeqno = validation.masterchainSeqno;
      await this.watchRepo.save(current);
      watch.lastFinalizedLt = current.lastFinalizedLt;
      watch.lastFinalizedTxHash = current.lastFinalizedTxHash;
      watch.lastFinalizedMcSeqno = current.lastFinalizedMcSeqno;
    }
    return event;
  }

  private async applyPendingEvents(
    report: TonNativeIngestionReport,
  ): Promise<void> {
    const pending = await this.eventRepo.find({
      where: {
        outcome: TonNativeChainEventOutcome.ACCEPTED,
        eventType: "fund",
        appliedAt: IsNull(),
        automationStoppedAt: IsNull(),
      },
      order: { createdAt: "ASC" },
      take: MAX_WATCHES_PER_RUN,
    });
    for (const event of pending) {
      this.recordApplyResult(await this.applyEvent(event), report);
    }
  }

  private async applyEvent(
    event: TonNativeChainEvent,
  ): Promise<"applied" | "failed" | "skipped"> {
    const result = await this.applyLock.run(event.id, (locked, manager) =>
      this.applyLockedEvent(locked, manager),
    );
    return result.status === "acquired" ? result.value : "skipped";
  }

  private async applyLockedEvent(
    event: TonNativeChainEvent,
    manager: EntityManager,
  ): Promise<"applied" | "failed"> {
    event.applyAttempts += 1;
    try {
      const reconciliation = await this.reconciliation.assertReconciled(event);
      if (reconciliation) {
        event.reconciledAt = new Date();
        event.reconciliationSource = reconciliation.source;
        event.reconciliationEvidence = reconciliation;
        event.reconciliationError = null;
      }
      const preparation = await this.preparationRepo.findOneOrFail({
        where: { id: event.preparationId },
      });
      await this.ledger.recordNativeTonEscrowFunding({
        chainEventId: event.id,
        dealId: event.dealId,
        buyerAddress: preparation.buyerAddress,
        buyerTotalAtomic: preparation.buyerTotalAtomic,
        requestValueAtomic: event.valueAtomic!,
        transactionHash: event.transactionHash,
        transactionLt: event.transactionLt,
        masterchainSeqno: event.masterchainSeqno,
      });
      await this.dealService.confirmPayment(
        event.dealId,
        Number(toDecimalTon(preparation.buyerTotalAtomic)),
        "TON",
      );
      event.appliedAt = new Date();
      event.lastApplyError = null;
      await manager.getRepository(TonNativeChainEvent).save(event);
      await this.watchRepo.update(
        { preparationId: event.preparationId },
        {
          status: TonNativeEscrowWatchStatus.FUNDED,
          lastError: null,
          consecutiveFailures: 0,
        },
      );
      return "applied";
    } catch (err) {
      event.lastApplyError = errorMessage(err);
      if (err instanceof TonNativeReconciliationError) {
        event.reconciliationError = event.lastApplyError;
      }
      if (
        err instanceof TonNativeReconciliationError ||
        event.applyAttempts >= APPLY_FAILURES_BEFORE_REVIEW
      ) {
        event.automationStoppedAt = new Date();
        await this.watchRepo.update(
          { preparationId: event.preparationId },
          {
            status: TonNativeEscrowWatchStatus.MANUAL_REVIEW,
            lastError: event.lastApplyError,
          },
        );
      }
      await manager.getRepository(TonNativeChainEvent).save(event);
      this.logger.error(
        `Could not apply native TON event ${event.id}: ${event.lastApplyError}`,
      );
      return "failed";
    }
  }

  private recordApplyResult(
    result: "applied" | "failed" | "skipped",
    report: TonNativeIngestionReport,
  ): void {
    if (result === "applied") report.applied += 1;
    if (result === "failed") report.applyFailed += 1;
  }
}

function compareLt(a: string | undefined, b: string | undefined): number {
  if (!a || !/^\d+$/.test(a)) return -1;
  if (!b || !/^\d+$/.test(b)) return 1;
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function toDecimalTon(value: string): string {
  const atomic = BigInt(value);
  const whole = atomic / 1_000_000_000n;
  const fraction = (atomic % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}
