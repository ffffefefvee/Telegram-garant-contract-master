import { beginCell } from "@ton/core";
import {
  TonJettonAction,
  TonJettonActionIntent,
} from "./entities/ton-jetton-action-intent.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import {
  TonJettonEscrowWatch,
  TonJettonEscrowWatchStatus,
} from "./entities/ton-jetton-escrow-watch.entity";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { TonJettonActionIntentService } from "./ton-jetton-action-intent.service";

const PREPARATION_ID = "11111111-1111-4111-8111-111111111111";
const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const BUYER = `0:${"1".repeat(64)}`;
const SELLER = `0:${"2".repeat(64)}`;
const ARBITRATOR = `0:${"3".repeat(64)}`;
const RECONCILIATION = `0:${"4".repeat(64)}`;

const OPCODE = {
  [TonJettonAction.MARK_DELIVERED]: 0x64656c76,
  [TonJettonAction.RELEASE]: 0x72656c73,
  [TonJettonAction.OPEN_DISPUTE]: 0x64737074,
  [TonJettonAction.RESOLVE]: 0x72736c76,
} as const;

function queryPayload(
  action: TonJettonAction.MARK_DELIVERED | TonJettonAction.OPEN_DISPUTE,
  queryId = 10n,
): string {
  return beginCell()
    .storeUint(OPCODE[action], 32)
    .storeUint(queryId, 64)
    .endCell()
    .toBoc()
    .toString("base64");
}

function releasePayload(queryId = 11n, settlementId = 99n): string {
  return beginCell()
    .storeUint(OPCODE[TonJettonAction.RELEASE], 32)
    .storeUint(queryId, 64)
    .storeUint(settlementId, 256)
    .storeUint(12n, 64)
    .storeUint(13n, 64)
    .storeUint(14n, 64)
    .endCell()
    .toBoc()
    .toString("base64");
}

function resolutionPayload(buyerAward: bigint, sellerAward: bigint): string {
  return beginCell()
    .storeUint(OPCODE[TonJettonAction.RESOLVE], 32)
    .storeUint(20n, 64)
    .storeUint(100n, 256)
    .storeCoins(buyerAward)
    .storeCoins(sellerAward)
    .storeUint(21n, 64)
    .storeUint(22n, 64)
    .storeUint(23n, 64)
    .endCell()
    .toBoc()
    .toString("base64");
}

function preparation(): TonJettonEscrowPreparation {
  return Object.assign(new TonJettonEscrowPreparation(), {
    id: PREPARATION_ID,
    dealId: DEAL_ID,
    network: TonNetwork.TESTNET,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    arbitratorAddress: ARBITRATOR,
    reconciliationAddress: RECONCILIATION,
    deliveryDeadline: "200",
    confirmationDeadline: "300",
    buyerTotalAtomic: "5000000",
    platformFeeAtomic: "100000",
  });
}

function queryReturning<T>(value: T) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ["where", "setLock"])
    query[method] = jest.fn(() => query);
  query.getOne = jest.fn().mockResolvedValue(value);
  return query;
}

function harness(status: TonJettonEscrowWatchStatus) {
  const prep = preparation();
  const watch = Object.assign(new TonJettonEscrowWatch(), {
    id: "watch-1",
    preparationId: prep.id,
    dealId: prep.dealId,
    status,
  });
  let existing: TonJettonActionIntent | null = null;
  const preparationRepo = {
    createQueryBuilder: jest.fn(() => queryReturning(prep)),
  };
  const watchRepo = {
    createQueryBuilder: jest.fn(() => queryReturning(watch)),
  };
  const intentRepo = {
    findOne: jest.fn(async () => existing),
    create: jest.fn((value) =>
      Object.assign(new TonJettonActionIntent(), value),
    ),
    save: jest.fn(async (value) => {
      existing = Object.assign(value, {
        id: value.id ?? "intent-1",
        createdAt: value.createdAt ?? new Date(),
      });
      return existing;
    }),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === TonJettonEscrowPreparation) return preparationRepo;
      if (entity === TonJettonEscrowWatch) return watchRepo;
      if (entity === TonJettonActionIntent) return intentRepo;
      throw new Error("unexpected repository");
    }),
  };
  const dataSource = {
    options: { type: "postgres" },
    transaction: jest.fn(async (handler) => handler(manager)),
  };
  const circuitBreaker = {
    assertEgressAllowed: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new TonJettonActionIntentService(
      dataSource as never,
      circuitBreaker as never,
    ),
    watch,
    intentRepo,
    circuitBreaker,
  };
}

describe("TonJettonActionIntentService", () => {
  it("persists an immutable seller delivery intent without opening egress", async () => {
    const h = harness(TonJettonEscrowWatchStatus.FUNDED);

    const result = await h.service.create({
      preparationId: PREPARATION_ID,
      action: TonJettonAction.MARK_DELIVERED,
      requesterId: "seller.user",
      senderAddress: SELLER,
      payload: queryPayload(TonJettonAction.MARK_DELIVERED),
      nowSeconds: 150,
    });

    expect(result).toEqual({
      status: "created",
      intent: expect.objectContaining({
        queryId: "10",
        expectedFromStatus: TonJettonEscrowWatchStatus.FUNDED,
        expectedToStatus: TonJettonEscrowWatchStatus.DELIVERED,
      }),
    });
    expect(h.circuitBreaker.assertEgressAllowed).not.toHaveBeenCalled();
  });

  it("checks the TON egress circuit before persisting a release intent", async () => {
    const h = harness(TonJettonEscrowWatchStatus.DELIVERED);

    const result = await h.service.create({
      preparationId: PREPARATION_ID,
      action: TonJettonAction.RELEASE,
      requesterId: "buyer.user",
      senderAddress: BUYER,
      payload: releasePayload(),
      nowSeconds: 250,
    });

    expect(result.intent).toEqual(
      expect.objectContaining({
        settlementId: "63".padStart(64, "0"),
        expectedToStatus: TonJettonEscrowWatchStatus.SETTLEMENT_PENDING,
      }),
    );
    expect(h.circuitBreaker.assertEgressAllowed).toHaveBeenCalledTimes(1);
  });

  it("converges an identical retry but rejects reuse with a different body", async () => {
    const h = harness(TonJettonEscrowWatchStatus.FUNDED);
    const request = {
      preparationId: PREPARATION_ID,
      action: TonJettonAction.MARK_DELIVERED,
      requesterId: "seller.user",
      senderAddress: SELLER,
      payload: queryPayload(TonJettonAction.MARK_DELIVERED),
      nowSeconds: 150,
    } as const;

    await h.service.create(request);
    await expect(h.service.create(request)).resolves.toMatchObject({
      status: "replayed",
    });
    await expect(
      h.service.create({
        ...request,
        action: TonJettonAction.OPEN_DISPUTE,
        requesterId: "buyer.user",
        senderAddress: BUYER,
        payload: queryPayload(TonJettonAction.OPEN_DISPUTE),
      }),
    ).rejects.toThrow("JETTON_ACTION_QUERY_ID_CONFLICT");
  });

  it("rejects an unauthorized sender before intent persistence", async () => {
    const h = harness(TonJettonEscrowWatchStatus.DELIVERED);

    await expect(
      h.service.create({
        preparationId: PREPARATION_ID,
        action: TonJettonAction.RELEASE,
        requesterId: "seller.user",
        senderAddress: SELLER,
        payload: releasePayload(),
        nowSeconds: 250,
      }),
    ).rejects.toThrow("JETTON_ACTION_UNAUTHORIZED");
    expect(h.intentRepo.save).not.toHaveBeenCalled();
  });

  it("rejects a non-conserving resolution plan", async () => {
    const h = harness(TonJettonEscrowWatchStatus.DISPUTED);

    await expect(
      h.service.create({
        preparationId: PREPARATION_ID,
        action: TonJettonAction.RESOLVE,
        requesterId: "arbitrator.user",
        senderAddress: ARBITRATOR,
        payload: resolutionPayload(2_000_000n, 2_000_000n),
        nowSeconds: 250,
      }),
    ).rejects.toThrow("JETTON_RESOLUTION_CONSERVATION_FAILED");
    expect(h.intentRepo.save).not.toHaveBeenCalled();
  });
});
