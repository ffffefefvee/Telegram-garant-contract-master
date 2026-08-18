import { EntityManager } from "typeorm";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import {
  TonJettonChainEvent,
  TonJettonChainEventOutcome,
  TonJettonEventApplication,
  TonJettonEventApplicationStatus,
  TonJettonIngestionCursor,
} from "./entities/ton-jetton-chain-event.entity";
import {
  TonJettonDurableIngestionService,
  TonJettonEvidenceConflictError,
  TonJettonFinalizedEventInput,
} from "./ton-jetton-durable-ingestion.service";

const ACCOUNT = `0:${"1".repeat(64)}`;
const TX_HASH = "2".repeat(64);
const MESSAGE_HASH = "3".repeat(64);

function input(
  overrides: Partial<TonJettonFinalizedEventInput> = {},
): TonJettonFinalizedEventInput {
  return {
    network: TonNetwork.TESTNET,
    accountAddress: ACCOUNT,
    transactionLt: "100",
    transactionHash: TX_HASH,
    masterchainSeqno: 50,
    transactionTime: 1_800_000_000,
    messageHash: MESSAGE_HASH,
    outcome: TonJettonChainEventOutcome.ACCEPTED,
    reasonCode: "JETTON_FUNDING_CONFIRMED",
    correlationKey: "deal-42",
    evidence: { amountAtomic: "2500000", nested: { verified: true } },
    ...overrides,
  };
}

function queryReturning<T>(get: () => T | null) {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    "insert",
    "values",
    "orIgnore",
    "where",
    "andWhere",
    "innerJoinAndSelect",
    "orderBy",
    "addOrderBy",
    "take",
    "setLock",
    "setOnLocked",
  ]) {
    query[method] = jest.fn(() => query);
  }
  query.execute = jest.fn().mockResolvedValue({ identifiers: [] });
  query.getOne = jest.fn(async () => get());
  return query;
}

function runner(manager: { getRepository: jest.Mock }) {
  return {
    manager,
    isTransactionActive: true,
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn(function (this: {
      isTransactionActive: boolean;
    }) {
      this.isTransactionActive = false;
      return Promise.resolve();
    }),
    rollbackTransaction: jest.fn(function (this: {
      isTransactionActive: boolean;
    }) {
      this.isTransactionActive = false;
      return Promise.resolve();
    }),
    release: jest.fn().mockResolvedValue(undefined),
  };
}

function appendHarness(existing: TonJettonChainEvent | null = null) {
  const cursor: TonJettonIngestionCursor = Object.assign(
    new TonJettonIngestionCursor(),
    {
      id: "cursor-1",
      network: TonNetwork.TESTNET,
      accountAddress: ACCOUNT,
      lastFinalizedLt: null,
      lastFinalizedTxHash: null,
      lastFinalizedMcSeqno: null,
      lastScannedAt: null,
    },
  );
  const insertQuery = queryReturning(() => null);
  const cursorQuery = queryReturning(() => cursor);
  const cursorRepo = {
    createQueryBuilder: jest
      .fn()
      .mockReturnValueOnce(insertQuery)
      .mockReturnValueOnce(cursorQuery),
    save: jest.fn(async (value) => value),
  };
  const eventRepo = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((value) => Object.assign(new TonJettonChainEvent(), value)),
    save: jest.fn(async (value) => Object.assign(value, { id: "event-1" })),
  };
  const applicationRepo = {
    create: jest.fn((value) =>
      Object.assign(new TonJettonEventApplication(), value),
    ),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === TonJettonIngestionCursor) return cursorRepo;
      if (entity === TonJettonChainEvent) return eventRepo;
      if (entity === TonJettonEventApplication) return applicationRepo;
      throw new Error("unexpected repository");
    }),
  };
  const queryRunner = runner(manager);
  const dataSource = {
    options: { type: "postgres" },
    createQueryRunner: jest.fn(() => queryRunner),
  };
  return {
    service: new TonJettonDurableIngestionService(dataSource as never),
    queryRunner,
    cursor,
    cursorRepo,
    cursorQuery,
    eventRepo,
    applicationRepo,
  };
}

function persistedEvent(): TonJettonChainEvent {
  return Object.assign(new TonJettonChainEvent(), input(), {
    id: "event-1",
    createdAt: new Date("2026-08-18T00:00:00Z"),
  });
}

describe("TonJettonDurableIngestionService evidence", () => {
  it("atomically appends accepted evidence, a pending application, and its cursor", async () => {
    const h = appendHarness();

    const result = await h.service.appendFinalizedEvent(input());

    expect(result.status).toBe("appended");
    expect(h.eventRepo.save).toHaveBeenCalledTimes(1);
    expect(h.applicationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-1",
        status: TonJettonEventApplicationStatus.PENDING,
        appliedAt: null,
      }),
    );
    expect(h.cursor.lastFinalizedLt).toBe("100");
    expect(h.cursor.lastFinalizedTxHash).toBe(TX_HASH);
    expect(h.cursorRepo.save).toHaveBeenCalledWith(h.cursor);
    expect(h.cursorQuery.setLock).toHaveBeenCalledWith("pessimistic_write");
    expect(h.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it("keeps rejected evidence append-only without making it applicable", async () => {
    const h = appendHarness();

    await h.service.appendFinalizedEvent(
      input({
        outcome: TonJettonChainEventOutcome.REJECTED,
        reasonCode: "ACTION_FAILED_OR_UNKNOWN",
      }),
    );

    expect(h.eventRepo.save).toHaveBeenCalledTimes(1);
    expect(h.applicationRepo.save).not.toHaveBeenCalled();
  });

  it("treats byte-equivalent observations as idempotent replay", async () => {
    const existing = persistedEvent();
    existing.evidence = { nested: { verified: true }, amountAtomic: "2500000" };
    const h = appendHarness(existing);

    const result = await h.service.appendFinalizedEvent(input());

    expect(result).toEqual({ status: "replayed", event: existing });
    expect(h.eventRepo.save).not.toHaveBeenCalled();
    expect(h.applicationRepo.save).not.toHaveBeenCalled();
    expect(h.cursorRepo.save).not.toHaveBeenCalled();
  });

  it("rejects conflicting evidence under the same durable identity", async () => {
    const h = appendHarness(persistedEvent());

    await expect(
      h.service.appendFinalizedEvent(
        input({ evidence: { amountAtomic: "999" } }),
      ),
    ).rejects.toBeInstanceOf(TonJettonEvidenceConflictError);
    expect(h.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(h.eventRepo.save).not.toHaveBeenCalled();
  });

  it("does not regress an account cursor while backfilling older evidence", async () => {
    const h = appendHarness();
    h.cursor.lastFinalizedLt = "200";
    h.cursor.lastFinalizedTxHash = "a".repeat(64);
    h.cursor.lastFinalizedMcSeqno = 60;

    await h.service.appendFinalizedEvent(input({ transactionLt: "100" }));

    expect(h.cursor.lastFinalizedLt).toBe("200");
    expect(h.cursor.lastFinalizedTxHash).toBe("a".repeat(64));
    expect(h.cursor.lastFinalizedMcSeqno).toBe(60);
    expect(h.cursor.lastScannedAt).toBeInstanceOf(Date);
  });

  it.each([
    [{ transactionLt: "01" }, "INVALID_JETTON_EVENT_LT"],
    [{ transactionHash: "AA".repeat(32) }, "INVALID_JETTON_EVENT_HASH"],
    [{ accountAddress: "friendly-address" }, "INVALID_JETTON_EVENT_ACCOUNT"],
    [{ masterchainSeqno: 0 }, "INVALID_JETTON_EVENT_MC_SEQNO"],
    [
      { evidence: [] as unknown as Record<string, unknown> },
      "INVALID_JETTON_EVENT_EVIDENCE",
    ],
  ])(
    "fails closed before storage for malformed event %j",
    async (change, code) => {
      const h = appendHarness();
      await expect(
        h.service.appendFinalizedEvent(input(change)),
      ).rejects.toThrow(code);
      expect(h.queryRunner.connect).not.toHaveBeenCalled();
    },
  );
});

interface ApplicationHarness {
  service: TonJettonDurableIngestionService;
  application: TonJettonEventApplication;
  primaryQueries: Array<ReturnType<typeof queryReturning>>;
  primarySaves: jest.Mock[];
  failureSaves: jest.Mock[];
  runners: Array<ReturnType<typeof runner>>;
}

function applicationHarness(maxFailures = 3): ApplicationHarness {
  const event = persistedEvent();
  const application = Object.assign(new TonJettonEventApplication(), {
    eventId: event.id,
    event,
    status: TonJettonEventApplicationStatus.PENDING,
    attempts: 0,
    lastError: null,
    appliedAt: null,
    manualReviewAt: null,
    updatedAt: new Date(),
  });
  const primaryQueries: Array<ReturnType<typeof queryReturning>> = [];
  const primarySaves: jest.Mock[] = [];
  const failureSaves: jest.Mock[] = [];
  const runners: Array<ReturnType<typeof runner>> = [];
  let runnerIndex = 0;
  const dataSource = {
    options: { type: "postgres" },
    createQueryRunner: jest.fn(() => {
      const isPrimary = runnerIndex++ % 2 === 0;
      const query = queryReturning(() =>
        isPrimary &&
        application.status !== TonJettonEventApplicationStatus.PENDING
          ? null
          : application,
      );
      const save = jest.fn(async (value) => value);
      const repository = { createQueryBuilder: jest.fn(() => query), save };
      const manager = {
        getRepository: jest.fn(() => repository),
      };
      const result = runner(manager);
      runners.push(result);
      if (isPrimary) {
        primaryQueries.push(query);
        primarySaves.push(save);
      } else {
        failureSaves.push(save);
      }
      return result;
    }),
  };
  return {
    service: new TonJettonDurableIngestionService(
      dataSource as never,
      maxFailures,
    ),
    application,
    primaryQueries,
    primarySaves,
    failureSaves,
    runners,
  };
}

describe("TonJettonDurableIngestionService application", () => {
  it("uses SKIP LOCKED and marks applied only after business writes succeed", async () => {
    const h = applicationHarness();
    const order: string[] = [];

    const result = await h.service.applyNext(async () => {
      order.push("business");
      expect(h.application.appliedAt).toBeNull();
    });
    order.push("done");

    expect(result).toEqual({ status: "applied", eventId: "event-1" });
    expect(order).toEqual(["business", "done"]);
    expect(h.primaryQueries[0].setLock).toHaveBeenCalledWith(
      "pessimistic_write",
    );
    expect(h.primaryQueries[0].setOnLocked).toHaveBeenCalledWith("skip_locked");
    expect(h.application.status).toBe(TonJettonEventApplicationStatus.APPLIED);
    expect(h.application.appliedAt).toBeInstanceOf(Date);
  });

  it("keeps appliedAt null when a later business repository write crashes", async () => {
    const h = applicationHarness();
    const firstBusinessWrite = jest.fn().mockResolvedValue(undefined);
    const laterBusinessWrite = jest
      .fn()
      .mockRejectedValue(new Error("simulated later write failure"));

    const result = await h.service.applyNext(async () => {
      await firstBusinessWrite();
      await laterBusinessWrite();
    });

    expect(result).toEqual({
      status: "retry_pending",
      eventId: "event-1",
      attempts: 1,
    });
    expect(firstBusinessWrite).toHaveBeenCalledTimes(1);
    expect(h.primarySaves[0]).not.toHaveBeenCalled();
    expect(h.runners[0].rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(h.application.appliedAt).toBeNull();
    expect(h.application.status).toBe(TonJettonEventApplicationStatus.PENDING);
    expect(h.failureSaves[0]).toHaveBeenCalledWith(
      expect.objectContaining({ appliedAt: null, attempts: 1 }),
    );
  });

  it("stops automation for manual review after the bounded failure count", async () => {
    const h = applicationHarness(3);
    const fail = () => Promise.reject(new Error("deterministic apply failure"));

    await expect(h.service.applyNext(fail)).resolves.toMatchObject({
      status: "retry_pending",
      attempts: 1,
    });
    await expect(h.service.applyNext(fail)).resolves.toMatchObject({
      status: "retry_pending",
      attempts: 2,
    });
    await expect(h.service.applyNext(fail)).resolves.toMatchObject({
      status: "manual_review",
      attempts: 3,
    });

    expect(h.application.status).toBe(
      TonJettonEventApplicationStatus.MANUAL_REVIEW,
    );
    expect(h.application.appliedAt).toBeNull();
    expect(h.application.manualReviewAt).toBeInstanceOf(Date);
    await expect(h.service.applyNext(fail)).resolves.toEqual({
      status: "idle",
    });
  });

  it("does not replay an already-applied event", async () => {
    const h = applicationHarness();
    h.application.status = TonJettonEventApplicationStatus.APPLIED;
    h.application.appliedAt = new Date();
    const handler = jest.fn().mockResolvedValue(undefined);

    await expect(h.service.applyNext(handler)).resolves.toEqual({
      status: "idle",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects unsafe retry bounds", () => {
    const dataSource = {} as never;
    expect(() => new TonJettonDurableIngestionService(dataSource, 0)).toThrow(
      "INVALID_JETTON_MAX_APPLY_FAILURES",
    );
    expect(() => new TonJettonDurableIngestionService(dataSource, 33)).toThrow(
      "INVALID_JETTON_MAX_APPLY_FAILURES",
    );
  });
});
