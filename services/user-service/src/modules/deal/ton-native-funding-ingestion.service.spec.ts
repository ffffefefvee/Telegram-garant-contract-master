import { Address, beginCell } from "@ton/ton";
import { MoneyLedgerService } from "../ops/money-ledger.service";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { DealService } from "./deal.service";
import {
  TonNativeChainEvent,
  TonNativeChainEventOutcome,
} from "./entities/ton-native-chain-event.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import { TonNativeEscrowWatchStatus } from "./entities/ton-native-escrow-watch.entity";
import {
  TON_NATIVE_FUND_OPCODE,
  TonCenterV3Service,
} from "./ton-center-v3.service";
import { TonNativeFundingIngestionService } from "./ton-native-funding-ingestion.service";
import { TonNativeReconciliationError } from "./ton-native-reconciliation.service";

describe("TonNativeFundingIngestionService", () => {
  it("persists, ledgers and applies one finalized Fund transaction", async () => {
    const buyer = Address.parseRaw(`0:${"11".repeat(32)}`).toRawString();
    const escrow = Address.parseRaw(`0:${"22".repeat(32)}`).toRawString();
    const code = beginCell().storeUint(1, 1).endCell();
    const config = beginCell().storeUint(2, 2).endCell();
    const payload = beginCell()
      .storeUint(TON_NATIVE_FUND_OPCODE, 32)
      .storeUint(42n, 64)
      .endCell();
    const data = beginCell()
      .storeUint(1, 8)
      .storeCoins(1_500_000_000n)
      .storeUint(42n, 64)
      .storeRef(config)
      .endCell();
    const preparation = Object.assign(new TonNativeEscrowPreparation(), {
      id: "10000000-0000-4000-8000-000000000001",
      dealId: "20000000-0000-4000-8000-000000000001",
      network: TonNetwork.TESTNET,
      escrowAddress: escrow,
      buyerAddress: buyer,
      buyerTotalAtomic: "1500000000",
      requestAmountAtomic: "1700000000",
      queryId: "42",
      fundingDeadline: "2000000000",
      payload: payload.toBoc().toString("base64"),
      codeHash: code.hash().toString("hex"),
      configHash: config.hash().toString("hex"),
      createdAt: new Date("2030-01-01T00:00:00Z"),
    });
    const watch = {
      id: "30000000-0000-4000-8000-000000000001",
      preparationId: preparation.id,
      dealId: preparation.dealId,
      network: TonNetwork.TESTNET,
      accountAddress: escrow,
      status: TonNativeEscrowWatchStatus.WATCHING,
      lastFinalizedLt: null,
      lastFinalizedTxHash: null,
      lastFinalizedMcSeqno: null,
      preparation,
    } as any;

    const tonCenter = {
      isEnabled: jest.fn().mockReturnValue(true),
      listFinalizedTransactions: jest.fn().mockResolvedValue([
        {
          account: escrow,
          account_state_after: {
            account_status: "active",
            code_hash: code.hash().toString("base64"),
            data_boc: data.toBoc().toString("base64"),
          },
          description: {
            aborted: false,
            compute_ph: { skipped: false, success: true, exit_code: 0 },
            action: { success: true, valid: true, result_code: 0 },
          },
          emulated: false,
          end_status: "active",
          hash: "tx-hash",
          in_msg: {
            bounced: false,
            destination: escrow,
            hash: "msg-hash",
            source: buyer,
            value: "1700000000",
            message_content: { body: payload.toBoc().toString("base64") },
          },
          lt: "123",
          mc_block_seqno: 99,
          now: 1_900_000_000,
        },
      ]),
    } as unknown as TonCenterV3Service;
    const dealService = {
      confirmPayment: jest.fn().mockResolvedValue({}),
    } as unknown as DealService;
    const ledger = {
      recordNativeTonEscrowFunding: jest.fn().mockResolvedValue({}),
    } as unknown as MoneyLedgerService;
    const queryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const preparationRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      findOneOrFail: jest.fn().mockResolvedValue(preparation),
    } as any;
    const watchRepo = {
      findOne: jest.fn().mockResolvedValue(watch),
      find: jest.fn().mockResolvedValue([watch]),
      findOneOrFail: jest.fn().mockResolvedValue(watch),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;
    let persistedEvent: any = null;
    const eventRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockImplementation(async () => persistedEvent),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        persistedEvent = { id: "event-id", ...value };
        return persistedEvent;
      }),
    } as any;
    const applyLock = {
      run: jest.fn(async (_id, handler) => ({
        status: "acquired",
        value: await handler(persistedEvent, {
          getRepository: () => eventRepo,
        }),
      })),
    } as any;
    const reconciliation = {
      assertReconciled: jest.fn().mockResolvedValue(null),
    } as any;

    const service = new TonNativeFundingIngestionService(
      tonCenter,
      dealService,
      ledger,
      preparationRepo,
      watchRepo,
      eventRepo,
      applyLock,
      reconciliation,
    );
    const report = await service.runOnce();

    expect(report).toMatchObject({
      watchesScanned: 1,
      transactionsObserved: 1,
      accepted: 1,
      rejected: 0,
      applied: 1,
      applyFailed: 0,
    });
    expect(persistedEvent.outcome).toBe(TonNativeChainEventOutcome.ACCEPTED);
    expect(ledger.recordNativeTonEscrowFunding).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: preparation.dealId,
        buyerTotalAtomic: "1500000000",
        transactionLt: "123",
      }),
    );
    expect(dealService.confirmPayment).toHaveBeenCalledWith(
      preparation.dealId,
      1.5,
      "TON",
    );
    expect(watchRepo.update).toHaveBeenCalledWith(
      { preparationId: preparation.id },
      expect.objectContaining({ status: TonNativeEscrowWatchStatus.FUNDED }),
    );
  });

  it("stops automation before accounting when independent evidence disagrees", async () => {
    const watchRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;
    const eventRepo = {
      save: jest.fn(async (value) => value),
    } as any;
    const ledger = {
      recordNativeTonEscrowFunding: jest.fn(),
    } as unknown as MoneyLedgerService;
    const dealService = {
      confirmPayment: jest.fn(),
    } as unknown as DealService;
    const reconciliation = {
      assertReconciled: jest
        .fn()
        .mockRejectedValue(
          new TonNativeReconciliationError("SECONDARY_POST_STATE_MISMATCH"),
        ),
    } as any;
    const service = new TonNativeFundingIngestionService(
      {} as TonCenterV3Service,
      dealService,
      ledger,
      {} as any,
      watchRepo,
      eventRepo,
      {} as any,
      reconciliation,
    );
    const event = Object.assign(new TonNativeChainEvent(), {
      id: "event-id",
      preparationId: "10000000-0000-4000-8000-000000000001",
      applyAttempts: 0,
      automationStoppedAt: null,
      reconciliationError: null,
      lastApplyError: null,
    });
    const manager = {
      getRepository: jest.fn().mockReturnValue(eventRepo),
    } as any;

    await expect(
      (service as any).applyLockedEvent(event, manager),
    ).resolves.toBe("failed");
    expect(event.reconciliationError).toBe("SECONDARY_POST_STATE_MISMATCH");
    expect(event.automationStoppedAt).toBeInstanceOf(Date);
    expect(watchRepo.update).toHaveBeenCalledWith(
      { preparationId: event.preparationId },
      expect.objectContaining({
        status: TonNativeEscrowWatchStatus.MANUAL_REVIEW,
      }),
    );
    expect(ledger.recordNativeTonEscrowFunding).not.toHaveBeenCalled();
    expect(dealService.confirmPayment).not.toHaveBeenCalled();
  });

  it("replays safely when the process fails after ledgering but before the deal transition", async () => {
    const preparation = Object.assign(new TonNativeEscrowPreparation(), {
      id: "10000000-0000-4000-8000-000000000010",
      dealId: "20000000-0000-4000-8000-000000000010",
      buyerAddress: `0:${"11".repeat(32)}`,
      buyerTotalAtomic: "1500000000",
    });
    const event = Object.assign(new TonNativeChainEvent(), {
      id: "event-replay",
      preparationId: preparation.id,
      dealId: preparation.dealId,
      valueAtomic: "1700000000",
      transactionHash: "tx-replay",
      transactionLt: "124",
      masterchainSeqno: 100,
      applyAttempts: 0,
      appliedAt: null,
      automationStoppedAt: null,
      lastApplyError: null,
    });
    const eventRepo = { save: jest.fn(async (value) => value) } as any;
    const ledger = {
      recordNativeTonEscrowFunding: jest
        .fn()
        .mockResolvedValueOnce({ id: "committed-ledger-entry" })
        .mockResolvedValueOnce(null),
    } as unknown as MoneyLedgerService;
    const dealService = {
      confirmPayment: jest
        .fn()
        .mockRejectedValueOnce(new Error("simulated crash before deal save"))
        .mockResolvedValueOnce({}),
    } as unknown as DealService;
    const watchRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;
    const service = new TonNativeFundingIngestionService(
      {} as TonCenterV3Service,
      dealService,
      ledger,
      { findOneOrFail: jest.fn().mockResolvedValue(preparation) } as any,
      watchRepo,
      eventRepo,
      {} as any,
      { assertReconciled: jest.fn().mockResolvedValue(null) } as any,
    );
    const manager = {
      getRepository: jest.fn().mockReturnValue(eventRepo),
    } as any;

    await expect(
      (service as any).applyLockedEvent(event, manager),
    ).resolves.toBe("failed");
    expect(event.appliedAt).toBeNull();
    await expect(
      (service as any).applyLockedEvent(event, manager),
    ).resolves.toBe("applied");

    expect(ledger.recordNativeTonEscrowFunding).toHaveBeenCalledTimes(2);
    expect(dealService.confirmPayment).toHaveBeenCalledTimes(2);
    expect(event.appliedAt).toBeInstanceOf(Date);
    expect(event.applyAttempts).toBe(2);
    expect(event.lastApplyError).toBeNull();
    expect(watchRepo.update).toHaveBeenLastCalledWith(
      { preparationId: preparation.id },
      expect.objectContaining({ status: TonNativeEscrowWatchStatus.FUNDED }),
    );
  });
});
