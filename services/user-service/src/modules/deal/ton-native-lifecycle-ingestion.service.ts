import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, IsNull, Not, Repository } from "typeorm";
import { MoneyLedgerService } from "../ops/money-ledger.service";
import { normalizeTonAddress } from "../escrow/adapters/ton-address";
import {
  TonNativeChainEvent,
  TonNativeChainEventOutcome,
} from "./entities/ton-native-chain-event.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import {
  TonNativeEscrowWatch,
  TonNativeEscrowWatchStatus,
} from "./entities/ton-native-escrow-watch.entity";
import { TonNativeLifecycleIntent } from "./entities/ton-native-lifecycle-intent.entity";
import { DealService } from "./deal.service";
import {
  TonCenterTransaction,
  TonCenterV3Service,
} from "./ton-center-v3.service";
import {
  parseTonNativeLifecyclePayload,
  TonNativeLifecycleAction,
} from "./ton-native-lifecycle";
import { validateTonNativeLifecycleTransaction } from "./ton-native-lifecycle-validator";
import { TonNativeEventApplyLockService } from "./ton-native-event-apply-lock.service";
import {
  TonNativeReconciliationError,
  TonNativeReconciliationService,
} from "./ton-native-reconciliation.service";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_WATCHES = 100;
const MAX_APPLY_ATTEMPTS = 5;

export interface TonNativeLifecycleIngestionReport {
  watchesScanned: number;
  observed: number;
  accepted: number;
  rejected: number;
  applied: number;
  applyFailed: number;
}

@Injectable()
export class TonNativeLifecycleIngestionService {
  private readonly logger = new Logger(TonNativeLifecycleIngestionService.name);

  constructor(
    private readonly tonCenter: TonCenterV3Service,
    private readonly dealService: DealService,
    private readonly ledger: MoneyLedgerService,
    @InjectRepository(TonNativeEscrowWatch)
    private readonly watchRepo: Repository<TonNativeEscrowWatch>,
    @InjectRepository(TonNativeEscrowPreparation)
    private readonly preparationRepo: Repository<TonNativeEscrowPreparation>,
    @InjectRepository(TonNativeLifecycleIntent)
    private readonly intentRepo: Repository<TonNativeLifecycleIntent>,
    @InjectRepository(TonNativeChainEvent)
    private readonly eventRepo: Repository<TonNativeChainEvent>,
    private readonly applyLock: TonNativeEventApplyLockService,
    private readonly reconciliation: TonNativeReconciliationService,
  ) {}

  isEnabled(): boolean {
    return this.tonCenter.isEnabled();
  }

  async runOnce(): Promise<TonNativeLifecycleIngestionReport> {
    const report: TonNativeLifecycleIngestionReport = {
      watchesScanned: 0,
      observed: 0,
      accepted: 0,
      rejected: 0,
      applied: 0,
      applyFailed: 0,
    };
    await this.applyPending(report);
    const watches = await this.watchRepo.find({
      where: {
        status: In([
          TonNativeEscrowWatchStatus.FUNDED,
          TonNativeEscrowWatchStatus.DISPUTED,
        ]),
      },
      relations: ["preparation"],
      order: { lastScannedAt: "ASC" },
      take: MAX_WATCHES,
    });
    for (const watch of watches) {
      try {
        const pageLimitReached = await this.scanWatch(watch, report, MAX_PAGES);
        if (pageLimitReached) {
          throw new Error(
            "TON lifecycle page limit reached; backfill is required",
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
        const message = errorMessage(err);
        await this.watchRepo.update(
          { id: watch.id },
          {
            consecutiveFailures: () => '"consecutiveFailures" + 1',
            lastError: message,
            lastScannedAt: new Date(),
          },
        );
        this.logger.warn(`TON lifecycle watch ${watch.id} failed: ${message}`);
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
    if (
      ![
        TonNativeEscrowWatchStatus.FUNDED,
        TonNativeEscrowWatchStatus.DISPUTED,
      ].includes(watch.status)
    ) {
      throw new ConflictException("Watch is not in an active lifecycle state");
    }
    const report: TonNativeLifecycleIngestionReport = {
      watchesScanned: 0,
      observed: 0,
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

  private async scanWatch(
    watch: TonNativeEscrowWatch,
    report: TonNativeLifecycleIngestionReport,
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
        const event = await this.observe(watch, preparation, transaction);
        report.observed += 1;
        if (event.outcome === TonNativeChainEventOutcome.ACCEPTED) {
          report.accepted += 1;
          this.recordApplyResult(await this.applyEvent(event), report);
          return false;
        }
        report.rejected += 1;
        startLt = (BigInt(event.transactionLt) + 1n).toString();
      }
      if (transactions.length < PAGE_SIZE) return false;
    }
    return true;
  }

  private async observe(
    watch: TonNativeEscrowWatch,
    preparation: TonNativeEscrowPreparation,
    transaction: TonCenterTransaction,
  ): Promise<TonNativeChainEvent> {
    const identity = requireIdentity(transaction, preparation.escrowAddress);
    const existing = await this.eventRepo.findOne({
      where: {
        network: preparation.network,
        accountAddress: identity.accountAddress,
        transactionLt: identity.transactionLt,
        transactionHash: identity.transactionHash,
      },
    });
    if (existing) {
      await this.advanceCursor(watch, existing);
      return existing;
    }

    let parsed: ReturnType<typeof parseTonNativeLifecyclePayload> | null = null;
    try {
      parsed = parseTonNativeLifecyclePayload(
        transaction.in_msg?.message_content?.body ?? "",
      );
    } catch {
      // Persisted below as rejected evidence.
    }
    const intent = parsed
      ? await this.intentRepo.findOne({
          where: {
            preparationId: preparation.id,
            action: parsed.action,
            queryId: parsed.queryId.toString(),
          },
        })
      : null;
    const validation = intent
      ? validateTonNativeLifecycleTransaction(transaction, preparation, intent)
      : null;
    const candidate = this.eventRepo.create({
      preparationId: preparation.id,
      dealId: preparation.dealId,
      eventType: parsed?.action ?? "unknown",
      intentId: intent?.id ?? null,
      network: preparation.network,
      accountAddress: identity.accountAddress,
      transactionLt: identity.transactionLt,
      transactionHash: identity.transactionHash,
      masterchainSeqno: identity.masterchainSeqno,
      transactionTime: identity.transactionTime,
      messageHash: validation?.messageHash ?? transaction.in_msg?.hash ?? null,
      sourceAddress:
        validation?.sourceAddress ??
        normalizeAddress(transaction.in_msg?.source),
      valueAtomic: validation?.valueAtomic ?? transaction.in_msg?.value ?? null,
      payloadHash: validation?.payloadHash ?? parsed?.hash ?? null,
      postCodeHash: validation?.postCodeHash ?? null,
      postConfigHash: validation?.postConfigHash ?? null,
      postStateHash: validation?.postStateHash ?? null,
      postDataHash: validation?.postDataHash ?? null,
      reconciledAt: null,
      reconciliationSource: null,
      reconciliationEvidence: null,
      reconciliationError: null,
      outcome: validation?.accepted
        ? TonNativeChainEventOutcome.ACCEPTED
        : TonNativeChainEventOutcome.REJECTED,
      reasonCode: validation?.reasonCode ?? "NO_MATCHING_LIFECYCLE_INTENT",
      evidence: validation?.evidence ?? {
        parsedAction: parsed?.action ?? null,
        parsedQueryId: parsed?.queryId.toString() ?? null,
      },
      applyAttempts: 0,
      appliedAt: null,
      automationStoppedAt: null,
      lastApplyError: null,
    });
    let event: TonNativeChainEvent;
    try {
      event = await this.eventRepo.save(candidate);
    } catch (err) {
      // Multiple scheduler replicas may observe the same finalized transaction.
      // The database identity constraint is the serialization boundary.
      if (!/unique/i.test(errorMessage(err))) throw err;
      const concurrent = await this.eventRepo.findOne({
        where: {
          network: preparation.network,
          accountAddress: identity.accountAddress,
          transactionLt: identity.transactionLt,
          transactionHash: identity.transactionHash,
        },
      });
      if (!concurrent) throw err;
      event = concurrent;
    }
    await this.advanceCursor(watch, event);
    return event;
  }

  private async advanceCursor(
    watch: TonNativeEscrowWatch,
    event: TonNativeChainEvent,
  ): Promise<void> {
    const current = await this.watchRepo.findOneOrFail({
      where: { id: watch.id },
    });
    if (
      !current.lastFinalizedLt ||
      BigInt(event.transactionLt) > BigInt(current.lastFinalizedLt)
    ) {
      current.lastFinalizedLt = event.transactionLt;
      current.lastFinalizedTxHash = event.transactionHash;
      current.lastFinalizedMcSeqno = event.masterchainSeqno;
      await this.watchRepo.save(current);
      watch.lastFinalizedLt = current.lastFinalizedLt;
    }
  }

  private async applyPending(
    report: TonNativeLifecycleIngestionReport,
  ): Promise<void> {
    const events = await this.eventRepo.find({
      where: {
        outcome: TonNativeChainEventOutcome.ACCEPTED,
        eventType: Not("fund"),
        intentId: Not(IsNull()),
        appliedAt: IsNull(),
        automationStoppedAt: IsNull(),
      },
      order: { createdAt: "ASC" },
      take: MAX_WATCHES,
    });
    for (const event of events) {
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
      const intent = await this.intentRepo.findOneOrFail({
        where: { id: event.intentId! },
      });
      const preparation = await this.preparationRepo.findOneOrFail({
        where: { id: event.preparationId },
      });
      await this.ledger.recordNativeTonSettlement({
        chainEventId: event.id,
        dealId: event.dealId,
        action: intent.action,
        buyerAddress: preparation.buyerAddress,
        sellerAddress: preparation.sellerAddress,
        treasuryAddress: preparation.treasuryAddress,
        sellerPayoutAtomic: preparation.sellerPayoutAtomic,
        platformFeeAtomic: preparation.platformFeeAtomic,
        refundToBuyerAtomic: preparation.refundToBuyerAtomic,
        refundFeeAtomic: preparation.refundFeeAtomic,
        buyerAwardAtomic: intent.buyerAwardAtomic,
        sellerAwardAtomic: intent.sellerAwardAtomic,
        transactionHash: event.transactionHash,
        transactionLt: event.transactionLt,
      });
      await this.dealService.applyFinalizedNativeTonLifecycle(
        event.dealId,
        intent.action,
        intent.requesterUserId,
        intent.reason,
        intent.action === TonNativeLifecycleAction.RESOLVE
          ? {
              decisionId: intent.decisionId!,
              decisionHash: intent.decisionHash!,
              buyerAwardAtomic: intent.buyerAwardAtomic!,
              sellerAwardAtomic: intent.sellerAwardAtomic!,
              transactionHash: event.transactionHash,
            }
          : undefined,
      );
      const appliedAt = new Date();
      intent.consumedByEventId = event.id;
      intent.consumedAt = appliedAt;
      await this.intentRepo.save(intent);
      await this.watchRepo.update(
        { preparationId: event.preparationId },
        {
          status: watchStatusAfter(intent.action),
          consecutiveFailures: 0,
          lastError: null,
        },
      );
      // Persist the retry-suppression marker last. Every preceding effect is
      // idempotent, so a process/database failure before this save leaves the
      // event eligible for replay instead of stranding a partially applied
      // lifecycle transition.
      event.appliedAt = appliedAt;
      event.lastApplyError = null;
      await manager.getRepository(TonNativeChainEvent).save(event);
      return "applied";
    } catch (err) {
      // A repository may mutate the entity before its write rejects. Never
      // persist a failed attempt as applied: applyPending selects NULL here.
      event.appliedAt = null;
      event.lastApplyError = errorMessage(err);
      if (err instanceof TonNativeReconciliationError) {
        event.reconciliationError = event.lastApplyError;
      }
      if (
        err instanceof TonNativeReconciliationError ||
        event.applyAttempts >= MAX_APPLY_ATTEMPTS
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
        `Could not apply TON lifecycle event ${event.id}: ${event.lastApplyError}`,
      );
      return "failed";
    }
  }

  private recordApplyResult(
    result: "applied" | "failed" | "skipped",
    report: TonNativeLifecycleIngestionReport,
  ): void {
    if (result === "applied") report.applied += 1;
    if (result === "failed") report.applyFailed += 1;
  }
}

function watchStatusAfter(
  action: TonNativeLifecycleAction,
): TonNativeEscrowWatchStatus {
  if (action === TonNativeLifecycleAction.OPEN_DISPUTE) {
    return TonNativeEscrowWatchStatus.DISPUTED;
  }
  if (
    action === TonNativeLifecycleAction.RELEASE ||
    action === TonNativeLifecycleAction.RELEASE_AFTER_BUYER_TIMEOUT ||
    action === TonNativeLifecycleAction.REFUND_BUYER ||
    action === TonNativeLifecycleAction.REFUND_AFTER_SELLER_TIMEOUT ||
    action === TonNativeLifecycleAction.RESOLVE
  ) {
    return TonNativeEscrowWatchStatus.TERMINAL;
  }
  return TonNativeEscrowWatchStatus.FUNDED;
}

function requireIdentity(
  transaction: TonCenterTransaction,
  expectedAccount: string,
): {
  accountAddress: string;
  transactionLt: string;
  transactionHash: string;
  masterchainSeqno: number;
  transactionTime: number;
} {
  const accountAddress = normalizeAddress(transaction.account);
  if (
    accountAddress !== expectedAccount ||
    !transaction.lt ||
    !/^\d+$/.test(transaction.lt) ||
    !transaction.hash ||
    !transaction.mc_block_seqno ||
    transaction.mc_block_seqno < 1 ||
    !Number.isSafeInteger(transaction.now)
  ) {
    throw new Error(
      "TON Center lifecycle transaction lacks a durable identity",
    );
  }
  return {
    accountAddress,
    transactionLt: transaction.lt,
    transactionHash: transaction.hash,
    masterchainSeqno: transaction.mc_block_seqno,
    transactionTime: transaction.now!,
  };
}

function normalizeAddress(value: string | undefined): string | null {
  return value ? normalizeTonAddress(value) : null;
}

function compareLt(a: string | undefined, b: string | undefined): number {
  if (!a || !/^\d+$/.test(a)) return -1;
  if (!b || !/^\d+$/.test(b)) return 1;
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}
