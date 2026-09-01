import { ConflictException } from "@nestjs/common";
import { Deal } from "./entities/deal.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import {
  TonJettonEscrowWatch,
  TonJettonEscrowWatchStatus,
} from "./entities/ton-jetton-escrow-watch.entity";
import {
  DealStatus,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "./enums/deal.enum";
import {
  preparationContentHash,
  TonJettonPreparationInput,
  TonJettonPreparationService,
} from "./ton-jetton-preparation.service";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";
const QUOTE_ID = "22222222-2222-4222-8222-222222222222";
const ADDRESS = (digit: string) => `0:${digit.repeat(64)}`;
const HASH = (digit: string) => digit.repeat(64);

function input(
  overrides: Partial<TonJettonPreparationInput> = {},
): TonJettonPreparationInput {
  return {
    dealId: DEAL_ID,
    network: TonNetwork.TESTNET,
    workchain: 0,
    codeHash: HASH("1"),
    configHash: HASH("2"),
    escrowAddress: ADDRESS("3"),
    stateInit: "te6ccg==",
    masterAddress: ADDRESS("4"),
    walletCodeHash: HASH("5"),
    sealedWalletAddress: ADDRESS("6"),
    walletVerificationEvidenceHash: HASH("7"),
    termsVersion: 3,
    termsHash: HASH("8"),
    quoteVersion: 2,
    quoteId: QUOTE_ID,
    quoteHash: HASH("9"),
    buyerAddress: ADDRESS("a"),
    sellerAddress: ADDRESS("b"),
    arbitratorAddress: ADDRESS("c"),
    treasuryAddress: ADDRESS("d"),
    initializerAddress: ADDRESS("e"),
    reconciliationAddress: ADDRESS("f"),
    assetCode: "USDT-TON",
    assetDecimals: 6,
    buyerTotalAtomic: "5000000",
    sellerPayoutAtomic: "4900000",
    platformFeeAtomic: "100000",
    refundToBuyerAtomic: "4950000",
    refundFeeAtomic: "50000",
    fundingQueryId: "9001",
    fundingForwardPayloadHash: HASH("a"),
    fundingDeadline: "2100000100",
    deliveryDeadline: "2100000200",
    confirmationDeadline: "2100000300",
    ...overrides,
  };
}

function query<T>(value: () => T | null) {
  const result: Record<string, jest.Mock> = {};
  for (const method of ["where", "orderBy", "take", "setLock"]) {
    result[method] = jest.fn(() => result);
  }
  result.getOne = jest.fn(async () => value());
  return result;
}

function deal(value = input()): Deal {
  return Object.assign(new Deal(), {
    id: DEAL_ID,
    status: DealStatus.PENDING_PAYMENT,
    settlementNetwork: SettlementNetwork.TON,
    settlementMode: SettlementMode.NATIVE,
    settlementAsset: SettlementAsset.TON_USDT,
    settlementChainId: value.network,
    assetContract: value.masterAddress,
    termsVersion: value.termsVersion,
    termsHash: value.termsHash,
    quoteId: null,
    escrowAddress: null,
    buyerWalletAddress: null,
    sellerWalletAddress: null,
    fundedAt: null,
  });
}

function harness(current: TonJettonEscrowPreparation | null = null) {
  const lockedDeal = deal();
  const dealQuery = query(() => lockedDeal);
  const preparationQuery = query(() => current);
  const dealRepo = {
    createQueryBuilder: jest.fn(() => dealQuery),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const preparationRepo = {
    createQueryBuilder: jest.fn(() => preparationQuery),
    create: jest.fn((value) =>
      Object.assign(new TonJettonEscrowPreparation(), value),
    ),
    save: jest.fn(async (value) =>
      Object.assign(value, { id: value.id ?? "preparation-created" }),
    ),
  };
  const currentWatch = current
    ? Object.assign(new TonJettonEscrowWatch(), {
        id: "watch-current",
        preparationId: current.id,
        dealId: DEAL_ID,
        network: current.network,
        accountAddress: current.escrowAddress,
        status: TonJettonEscrowWatchStatus.AWAITING_FUNDING,
      })
    : null;
  const watchQuery = query(() => currentWatch);
  const watchRepo = {
    createQueryBuilder: jest.fn(() => watchQuery),
    create: jest.fn((value) =>
      Object.assign(new TonJettonEscrowWatch(), value),
    ),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === Deal) return dealRepo;
      if (entity === TonJettonEscrowPreparation) return preparationRepo;
      if (entity === TonJettonEscrowWatch) return watchRepo;
      throw new Error("unexpected repository");
    }),
  };
  const dataSource = {
    options: { type: "postgres" },
    transaction: jest.fn(async (handler) => handler(manager)),
  };
  const circuitBreaker = {
    assertFundingAllowed: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new TonJettonPreparationService(
      dataSource as never,
      circuitBreaker as never,
    ),
    lockedDeal,
    dealQuery,
    preparationQuery,
    dealRepo,
    preparationRepo,
    currentWatch,
    watchRepo,
    circuitBreaker,
  };
}

function persisted(
  value: TonJettonPreparationInput = input(),
  version = 1,
): TonJettonEscrowPreparation {
  return Object.assign(new TonJettonEscrowPreparation(), value, {
    id: `preparation-${version}`,
    version,
    previousPreparationId: null,
    contentHash: preparationContentHash(value),
    createdAt: new Date("2026-09-01T00:00:00Z"),
  });
}

describe("TonJettonPreparationService", () => {
  it("creates and binds the first immutable preparation under a deal lock", async () => {
    const h = harness();

    const result = await h.service.prepare(input());

    expect(result.status).toBe("created");
    expect(result.preparation).toEqual(
      expect.objectContaining({
        version: 1,
        previousPreparationId: null,
        contentHash: preparationContentHash(input()),
      }),
    );
    expect(h.dealQuery.setLock).toHaveBeenCalledWith("pessimistic_write");
    expect(h.circuitBreaker.assertFundingAllowed).toHaveBeenCalledTimes(1);
    expect(h.preparationQuery.setLock).toHaveBeenCalledWith("pessimistic_read");
    expect(h.dealRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DEAL_ID,
        status: DealStatus.PENDING_PAYMENT,
      }),
      expect.objectContaining({
        quoteId: QUOTE_ID,
        escrowAddress: input().escrowAddress,
      }),
    );
    expect(h.watchRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        preparationId: "preparation-created",
        status: TonJettonEscrowWatchStatus.AWAITING_FUNDING,
      }),
    );
  });

  it("converges an identical retry without inserting or rebinding", async () => {
    const current = persisted();
    const h = harness(current);

    await expect(h.service.prepare(input())).resolves.toEqual({
      status: "replayed",
      preparation: current,
    });
    expect(h.preparationRepo.save).not.toHaveBeenCalled();
    expect(h.dealRepo.update).not.toHaveBeenCalled();
  });

  it("inserts a linked version when any canonical input changes before funding", async () => {
    const current = persisted();
    const h = harness(current);
    const changed = input({
      quoteId: "33333333-3333-4333-8333-333333333333",
      quoteHash: HASH("b"),
    });

    const result = await h.service.prepare(changed);

    expect(result.preparation).toEqual(
      expect.objectContaining({
        version: 2,
        previousPreparationId: current.id,
        quoteHash: HASH("b"),
      }),
    );
    expect(h.currentWatch?.status).toBe(TonJettonEscrowWatchStatus.SUPERSEDED);
  });

  it("never replaces a funded preparation with mismatched inputs", async () => {
    const current = persisted();
    const h = harness(current);
    h.lockedDeal.fundedAt = new Date();

    await expect(
      h.service.prepare(
        input({
          quoteId: "33333333-3333-4333-8333-333333333333",
          quoteHash: HASH("b"),
        }),
      ),
    ).rejects.toThrow("JETTON_FUNDED_PREPARATION_VERSION_IS_IMMUTABLE");
    expect(h.preparationRepo.save).not.toHaveBeenCalled();
    expect(h.dealRepo.update).not.toHaveBeenCalled();
  });

  it("rejects a deal bound to another Jetton master", async () => {
    const h = harness();
    h.lockedDeal.assetContract = ADDRESS("f");

    await expect(h.service.prepare(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("rejects non-conserving release economics", async () => {
    const h = harness();

    await expect(
      h.service.prepare(input({ platformFeeAtomic: "99999" })),
    ).rejects.toThrow("INVALID_JETTON_PREPARATION_RELEASE_CONSERVATION");
    expect(h.dealQuery.getOne).not.toHaveBeenCalled();
  });
});
