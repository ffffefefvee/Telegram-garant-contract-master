import { DataSource, EntityManager, QueryRunner } from "typeorm";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import {
  TonJettonChainEvent,
  TonJettonChainEventOutcome,
  TonJettonEventApplication,
  TonJettonEventApplicationStatus,
  TonJettonIngestionCursor,
} from "./entities/ton-jetton-chain-event.entity";

const UINT64_DECIMAL = /^(0|[1-9]\d{0,19})$/;
const HASH_256 = /^[0-9a-f]{64}$/;
const RAW_TON_ADDRESS = /^-?\d+:[0-9a-f]{64}$/;

export interface TonJettonFinalizedEventInput {
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
        correlationKey: input.correlationKey ?? null,
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
      if (application.attempts >= this.maxApplyFailures) {
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
    existing.masterchainSeqno === input.masterchainSeqno &&
    existing.transactionTime === input.transactionTime &&
    existing.messageHash === input.messageHash &&
    existing.outcome === input.outcome &&
    existing.reasonCode === input.reasonCode &&
    existing.correlationKey === (input.correlationKey ?? null) &&
    stableJson(existing.evidence) === stableJson(input.evidence)
  );
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
