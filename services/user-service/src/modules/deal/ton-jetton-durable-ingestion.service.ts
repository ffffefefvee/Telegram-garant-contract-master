import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import {
  TonJettonChainEvent,
  TonJettonChainEventKind,
  TonJettonChainEventOutcome,
  TonJettonApplicationReview,
  TonJettonApplicationReviewAction,
  TonJettonCursorCheckpointKind,
  TonJettonEventApplication,
  TonJettonEventApplicationStatus,
  TonJettonIngestionCursor,
  TonJettonIngestionCursorCheckpoint,
} from "./entities/ton-jetton-chain-event.entity";

const UINT64_DECIMAL = /^(0|[1-9]\d{0,19})$/;
const HASH_256 = /^[0-9a-f]{64}$/;
const RAW_TON_ADDRESS = /^-?\d+:[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BACKFILL_PAGES = 32;
const MAX_EVENTS_PER_PAGE = 100;

export interface TonJettonFinalizedEventInput {
  preparationId: string;
  actionIntentId?: string | null;
  eventKind: TonJettonChainEventKind;
  network: TonNetwork;
  accountAddress: string;
  transactionLt: string;
  transactionHash: string;
  masterchainSeqno: number;
  transactionTime: number;
  messageHash: string | null;
  outcome: TonJettonChainEventOutcome;
  reasonCode: string;
  correlationKey?: string | null;
  evidence: Record<string, unknown>;
}

export interface TonJettonCursorRecoveryInput {
  network: TonNetwork;
  accountAddress: string;
  toLt: string | null;
  toTransactionHash: string | null;
  toMasterchainSeqno: number | null;
  reasonCode: string;
  actorId: string;
}

export interface TonJettonBackfillReport {
  pages: number;
  appended: number;
  replayed: number;
}

export interface TonJettonManualReviewRequeueInput {
  eventId: string;
  reasonCode: string;
  actorId: string;
}

export type TonJettonAppendResult =
  | { status: "appended"; event: TonJettonChainEvent }
  | { status: "replayed"; event: TonJettonChainEvent };

export type TonJettonApplyResult =
  | { status: "idle" }
  | { status: "applied"; eventId: string }
  | { status: "retry_pending"; eventId: string; attempts: number }
  | { status: "manual_review"; eventId: string; attempts: number };

export class TonJettonEvidenceConflictError extends Error {
  constructor() {
    super("JETTON_EVENT_IDENTITY_CONFLICT");
    this.name = "TonJettonEvidenceConflictError";
  }
}

/**
 * Durable Jetton event storage/application primitive.
 *
 * This class intentionally has no Nest provider annotation or module wiring.
 * It is not a scheduler, does not activate the TON rail, and knows nothing
 * about a future full escrow lifecycle. A production composition root may
 * instantiate it only after the Jetton contract/release gates are approved.
 */
@Injectable()
export class TonJettonDurableIngestionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly maxApplyFailures = 3,
  ) {
    if (
      !Number.isInteger(maxApplyFailures) ||
      maxApplyFailures < 1 ||
      maxApplyFailures > 32
    ) {
      throw new Error("INVALID_JETTON_MAX_APPLY_FAILURES");
    }
  }

  /**
   * Stores immutable accepted/rejected evidence and advances the account cursor
   * in one transaction. A per-account cursor lock serializes concurrent pages.
   */
  async appendFinalizedEvent(
    input: TonJettonFinalizedEventInput,
  ): Promise<TonJettonAppendResult> {
    validateInput(input);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const cursorRepo = runner.manager.getRepository(TonJettonIngestionCursor);
      await cursorRepo
        .createQueryBuilder()
        .insert()
        .values({
          network: input.network,
          accountAddress: input.accountAddress,
          lastFinalizedLt: null,
          lastFinalizedTxHash: null,
          lastFinalizedMcSeqno: null,
          lastScannedAt: null,
        })
        .orIgnore()
        .execute();

      let cursorQuery = cursorRepo
        .createQueryBuilder("cursor")
        .where("cursor.network = :network", { network: input.network })
        .andWhere("cursor.accountAddress = :accountAddress", {
          accountAddress: input.accountAddress,
        });
      if (this.dataSource.options.type === "postgres") {
        cursorQuery = cursorQuery.setLock("pessimistic_write");
      }
      const cursor = await cursorQuery.getOne();
      if (!cursor) throw new Error("JETTON_CURSOR_LOCK_FAILED");

      const eventRepo = runner.manager.getRepository(TonJettonChainEvent);
      const existing = await eventRepo.findOne({
        where: {
          network: input.network,
          accountAddress: input.accountAddress,
          transactionLt: input.transactionLt,
          transactionHash: input.transactionHash,
        },
      });
      if (existing) {
        if (!sameEvidence(existing, input)) {
          throw new TonJettonEvidenceConflictError();
        }
        await runner.commitTransaction();
        return { status: "replayed", event: existing };
      }

      const event = eventRepo.create({
        ...input,
        actionIntentId: input.actionIntentId ?? null,
        correlationKey: input.correlationKey ?? null,
        evidenceHash: tonJettonEvidenceHash(input.evidence),
      });
      const saved = await eventRepo.save(event);

      if (saved.outcome === TonJettonChainEventOutcome.ACCEPTED) {
        const applicationRepo = runner.manager.getRepository(
          TonJettonEventApplication,
        );
        await applicationRepo.save(
          applicationRepo.create({
            eventId: saved.id,
            status: TonJettonEventApplicationStatus.PENDING,
            attempts: 0,
            lastError: null,
            appliedAt: null,
            manualReviewAt: null,
          }),
        );
      }

      if (
        cursor.lastFinalizedLt === null ||
        BigInt(saved.transactionLt) > BigInt(cursor.lastFinalizedLt)
      ) {
        const checkpointRepo = runner.manager.getRepository(
          TonJettonIngestionCursorCheckpoint,
        );
        await checkpointRepo.save(
          checkpointRepo.create({
            cursorId: cursor.id,
            kind: TonJettonCursorCheckpointKind.ADVANCE,
            previousLt: cursor.lastFinalizedLt,
            previousHash: cursor.lastFinalizedTxHash,
            previousMcSeqno: cursor.lastFinalizedMcSeqno,
            nextLt: saved.transactionLt,
            nextHash: saved.transactionHash,
            nextMcSeqno: saved.masterchainSeqno,
            reasonCode: "FINALIZED_EVENT_ADVANCE",
            actorId: "ton-jetton.ingestion",
          }),
        );
        cursor.lastFinalizedLt = saved.transactionLt;
        cursor.lastFinalizedTxHash = saved.transactionHash;
        cursor.lastFinalizedMcSeqno = saved.masterchainSeqno;
      }
      cursor.lastScannedAt = new Date();
      await cursorRepo.save(cursor);
      await runner.commitTransaction();
      return { status: "appended", event: saved };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  /** Applies a source backfill with explicit hard page/event bounds. */
  async appendBoundedBackfill(
    pages: readonly (readonly TonJettonFinalizedEventInput[])[],
  ): Promise<TonJettonBackfillReport> {
    if (pages.length < 1 || pages.length > MAX_BACKFILL_PAGES) {
      throw new Error("INVALID_JETTON_BACKFILL_PAGE_COUNT");
    }
    const report: TonJettonBackfillReport = {
      pages: pages.length,
      appended: 0,
      replayed: 0,
    };
    let accountIdentity: string | null = null;
    for (const page of pages) {
      if (page.length < 1 || page.length > MAX_EVENTS_PER_PAGE) {
        throw new Error("INVALID_JETTON_BACKFILL_PAGE_SIZE");
      }
      for (const event of page) {
        const identity = `${event.network}:${event.accountAddress}`;
        accountIdentity ??= identity;
        if (identity !== accountIdentity) {
          throw new Error("JETTON_BACKFILL_ACCOUNT_MISMATCH");
        }
        const result = await this.appendFinalizedEvent(event);
        report[result.status] += 1;
      }
    }
    return report;
  }

  /**
   * Manual cursor recovery. The mutable high-water mark is rewound only in
   * the same transaction that appends its immutable recovery checkpoint.
   */
  async rewindCursor(
    input: TonJettonCursorRecoveryInput,
  ): Promise<TonJettonIngestionCursor> {
    validateCursorRecovery(input);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const cursorRepo = runner.manager.getRepository(TonJettonIngestionCursor);
      let query = cursorRepo
        .createQueryBuilder("cursor")
        .where("cursor.network = :network", { network: input.network })
        .andWhere("cursor.accountAddress = :accountAddress", {
          accountAddress: input.accountAddress,
        });
      if (this.dataSource.options.type === "postgres") {
        query = query.setLock("pessimistic_write");
      }
      const cursor = await query.getOne();
      if (!cursor || cursor.lastFinalizedLt === null) {
        throw new Error("JETTON_CURSOR_NOT_RECOVERABLE");
      }
      if (
        input.toLt !== null &&
        BigInt(input.toLt) >= BigInt(cursor.lastFinalizedLt)
      ) {
        throw new Error("JETTON_CURSOR_RECOVERY_MUST_REWIND");
      }
      const checkpointRepo = runner.manager.getRepository(
        TonJettonIngestionCursorCheckpoint,
      );
      await checkpointRepo.save(
        checkpointRepo.create({
          cursorId: cursor.id,
          kind: TonJettonCursorCheckpointKind.RECOVERY,
          previousLt: cursor.lastFinalizedLt,
          previousHash: cursor.lastFinalizedTxHash,
          previousMcSeqno: cursor.lastFinalizedMcSeqno,
          nextLt: input.toLt,
          nextHash: input.toTransactionHash,
          nextMcSeqno: input.toMasterchainSeqno,
          reasonCode: input.reasonCode,
          actorId: input.actorId,
        }),
      );
      cursor.lastFinalizedLt = input.toLt;
      cursor.lastFinalizedTxHash = input.toTransactionHash;
      cursor.lastFinalizedMcSeqno = input.toMasterchainSeqno;
      cursor.lastScannedAt = new Date();
      const saved = await cursorRepo.save(cursor);
      await runner.commitTransaction();
      return saved;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  /** Requeues a stopped event only with an immutable operator review record. */
  async requeueManualReview(
    input: TonJettonManualReviewRequeueInput,
  ): Promise<TonJettonEventApplication> {
    if (!UUID.test(input.eventId))
      throw new Error("INVALID_JETTON_REVIEW_EVENT");
    if (!/^[A-Z0-9_]{3,64}$/.test(input.reasonCode)) {
      throw new Error("INVALID_JETTON_REVIEW_REASON");
    }
    if (!/^[a-zA-Z0-9._:@-]{3,128}$/.test(input.actorId)) {
      throw new Error("INVALID_JETTON_REVIEW_ACTOR");
    }
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const repository = runner.manager.getRepository(
        TonJettonEventApplication,
      );
      let query = repository
        .createQueryBuilder("application")
        .where("application.eventId = :eventId", { eventId: input.eventId });
      if (this.dataSource.options.type === "postgres") {
        query = query.setLock("pessimistic_write");
      }
      const application = await query.getOne();
      if (
        !application ||
        application.status !== TonJettonEventApplicationStatus.MANUAL_REVIEW
      ) {
        throw new Error("JETTON_APPLICATION_NOT_IN_MANUAL_REVIEW");
      }
      const auditRepo = runner.manager.getRepository(
        TonJettonApplicationReview,
      );
      await auditRepo.save(
        auditRepo.create({
          eventId: input.eventId,
          action: TonJettonApplicationReviewAction.REQUEUE,
          previousAttempts: application.attempts,
          previousError: application.lastError,
          reasonCode: input.reasonCode,
          actorId: input.actorId,
        }),
      );
      application.status = TonJettonEventApplicationStatus.PENDING;
      application.attempts = 0;
      application.lastError = null;
      application.appliedAt = null;
      application.manualReviewAt = null;
      const saved = await repository.save(application);
      await runner.commitTransaction();
      return saved;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  /**
   * Applies one accepted event under FOR UPDATE SKIP LOCKED. All business writes
   * performed by handler use the same transaction. `appliedAt` is persisted
   * only after the handler succeeds, so a crash/throw rolls everything back and
   * leaves the event eligible for replay.
   */
  async applyNext(
    handler: (
      event: TonJettonChainEvent,
      manager: EntityManager,
    ) => Promise<void>,
  ): Promise<TonJettonApplyResult> {
    const runner = this.dataSource.createQueryRunner();
    let selectedEventId: string | null = null;
    let applicationError: unknown;
    await runner.connect();
    await runner.startTransaction();
    try {
      const applicationRepo = runner.manager.getRepository(
        TonJettonEventApplication,
      );
      let query = applicationRepo
        .createQueryBuilder("application")
        .innerJoinAndSelect("application.event", "event")
        .where("application.status = :status", {
          status: TonJettonEventApplicationStatus.PENDING,
        })
        .orderBy("application.updatedAt", "ASC")
        .addOrderBy("application.eventId", "ASC")
        .take(1);
      if (this.dataSource.options.type === "postgres") {
        query = query.setLock("pessimistic_write").setOnLocked("skip_locked");
      }
      const application = await query.getOne();
      if (!application) {
        await runner.commitTransaction();
        return { status: "idle" };
      }
      selectedEventId = application.eventId;

      await handler(application.event, runner.manager);

      // This is deliberately the last database write in the business tx.
      application.status = TonJettonEventApplicationStatus.APPLIED;
      application.appliedAt = new Date();
      application.lastError = null;
      await applicationRepo.save(application);
      await runner.commitTransaction();
      return { status: "applied", eventId: application.eventId };
    } catch (error) {
      applicationError = error;
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }

    if (!selectedEventId) throw asError(applicationError);
    return this.recordApplyFailure(selectedEventId, applicationError);
  }

  private async recordApplyFailure(
    eventId: string,
    error: unknown,
  ): Promise<TonJettonApplyResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const repository = runner.manager.getRepository(
        TonJettonEventApplication,
      );
      let query = repository
        .createQueryBuilder("application")
        .where("application.eventId = :eventId", { eventId });
      if (this.dataSource.options.type === "postgres") {
        query = query.setLock("pessimistic_write");
      }
      const application = await query.getOne();
      if (!application) throw new Error("JETTON_APPLICATION_NOT_FOUND");
      if (application.status === TonJettonEventApplicationStatus.APPLIED) {
        await runner.commitTransaction();
        return { status: "applied", eventId };
      }
      if (
        application.status === TonJettonEventApplicationStatus.MANUAL_REVIEW
      ) {
        await runner.commitTransaction();
        return {
          status: "manual_review",
          eventId,
          attempts: application.attempts,
        };
      }

      application.attempts += 1;
      application.lastError = safeErrorMessage(error);
      // A failed attempt must never make the event look applied.
      application.appliedAt = null;
      if (
        immediateManualReview(error) ||
        application.attempts >= this.maxApplyFailures
      ) {
        application.status = TonJettonEventApplicationStatus.MANUAL_REVIEW;
        application.manualReviewAt = new Date();
      }
      await repository.save(application);
      await runner.commitTransaction();
      return application.status ===
        TonJettonEventApplicationStatus.MANUAL_REVIEW
        ? {
            status: "manual_review",
            eventId,
            attempts: application.attempts,
          }
        : {
            status: "retry_pending",
            eventId,
            attempts: application.attempts,
          };
    } catch (failureRecordingError) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw failureRecordingError;
    } finally {
      await runner.release();
    }
  }
}

function validateInput(input: TonJettonFinalizedEventInput): void {
  if (!UUID.test(input.preparationId)) {
    throw new Error("INVALID_JETTON_EVENT_PREPARATION");
  }
  if (
    input.actionIntentId !== undefined &&
    input.actionIntentId !== null &&
    !UUID.test(input.actionIntentId)
  ) {
    throw new Error("INVALID_JETTON_EVENT_ACTION_INTENT");
  }
  if (!Object.values(TonJettonChainEventKind).includes(input.eventKind)) {
    throw new Error("INVALID_JETTON_EVENT_KIND");
  }
  if (!Object.values(TonNetwork).includes(input.network)) {
    throw new Error("INVALID_JETTON_EVENT_NETWORK");
  }
  if (!RAW_TON_ADDRESS.test(input.accountAddress)) {
    throw new Error("INVALID_JETTON_EVENT_ACCOUNT");
  }
  if (
    !UINT64_DECIMAL.test(input.transactionLt) ||
    BigInt(input.transactionLt) < 1n ||
    BigInt(input.transactionLt) > (1n << 64n) - 1n
  ) {
    throw new Error("INVALID_JETTON_EVENT_LT");
  }
  if (!HASH_256.test(input.transactionHash)) {
    throw new Error("INVALID_JETTON_EVENT_HASH");
  }
  if (input.messageHash !== null && !HASH_256.test(input.messageHash)) {
    throw new Error("INVALID_JETTON_MESSAGE_HASH");
  }
  if (
    !Number.isSafeInteger(input.masterchainSeqno) ||
    input.masterchainSeqno < 1
  ) {
    throw new Error("INVALID_JETTON_EVENT_MC_SEQNO");
  }
  if (
    !Number.isSafeInteger(input.transactionTime) ||
    input.transactionTime < 1
  ) {
    throw new Error("INVALID_JETTON_EVENT_TIME");
  }
  if (!Object.values(TonJettonChainEventOutcome).includes(input.outcome)) {
    throw new Error("INVALID_JETTON_EVENT_OUTCOME");
  }
  if (!/^[A-Z0-9_]{1,64}$/.test(input.reasonCode)) {
    throw new Error("INVALID_JETTON_EVENT_REASON");
  }
  if (
    input.correlationKey !== undefined &&
    input.correlationKey !== null &&
    (input.correlationKey.length < 1 || input.correlationKey.length > 128)
  ) {
    throw new Error("INVALID_JETTON_EVENT_CORRELATION");
  }
  if (!isPlainRecord(input.evidence)) {
    throw new Error("INVALID_JETTON_EVENT_EVIDENCE");
  }
}

function sameEvidence(
  existing: TonJettonChainEvent,
  input: TonJettonFinalizedEventInput,
): boolean {
  return (
    existing.preparationId === input.preparationId &&
    existing.actionIntentId === (input.actionIntentId ?? null) &&
    existing.eventKind === input.eventKind &&
    existing.masterchainSeqno === input.masterchainSeqno &&
    existing.transactionTime === input.transactionTime &&
    existing.messageHash === input.messageHash &&
    existing.outcome === input.outcome &&
    existing.reasonCode === input.reasonCode &&
    existing.correlationKey === (input.correlationKey ?? null) &&
    existing.evidenceHash === tonJettonEvidenceHash(input.evidence) &&
    stableJson(existing.evidence) === stableJson(input.evidence)
  );
}

function validateCursorRecovery(input: TonJettonCursorRecoveryInput): void {
  if (!Object.values(TonNetwork).includes(input.network)) {
    throw new Error("INVALID_JETTON_CURSOR_NETWORK");
  }
  if (!RAW_TON_ADDRESS.test(input.accountAddress)) {
    throw new Error("INVALID_JETTON_CURSOR_ACCOUNT");
  }
  const allNull =
    input.toLt === null &&
    input.toTransactionHash === null &&
    input.toMasterchainSeqno === null;
  const allPresent =
    input.toLt !== null &&
    input.toTransactionHash !== null &&
    input.toMasterchainSeqno !== null;
  if (!allNull && !allPresent) {
    throw new Error("INVALID_JETTON_CURSOR_RECOVERY_TARGET");
  }
  if (allPresent) {
    if (
      !UINT64_DECIMAL.test(input.toLt!) ||
      BigInt(input.toLt!) < 1n ||
      !HASH_256.test(input.toTransactionHash!) ||
      !Number.isSafeInteger(input.toMasterchainSeqno) ||
      input.toMasterchainSeqno! < 1
    ) {
      throw new Error("INVALID_JETTON_CURSOR_RECOVERY_TARGET");
    }
  }
  if (!/^[A-Z0-9_]{3,64}$/.test(input.reasonCode)) {
    throw new Error("INVALID_JETTON_CURSOR_RECOVERY_REASON");
  }
  if (!/^[a-zA-Z0-9._:@-]{3,128}$/.test(input.actorId)) {
    throw new Error("INVALID_JETTON_CURSOR_RECOVERY_ACTOR");
  }
}

export function tonJettonEvidenceHash(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update("TON_JETTON_RAW_EVIDENCE_V1\0", "utf8")
    .update(stableJson(value), "utf8")
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function immediateManualReview(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "JETTON_SOURCE_DISAGREEMENT"
  );
}
