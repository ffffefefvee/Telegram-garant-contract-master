import { beginCell } from "@ton/ton";
import { MoneyLedgerService } from "../ops/money-ledger.service";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { DealService } from "./deal.service";
import { TonNativeChainEventOutcome } from "./entities/ton-native-chain-event.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import { TonNativeEscrowWatchStatus } from "./entities/ton-native-escrow-watch.entity";
import { TonNativeLifecycleIntent } from "./entities/ton-native-lifecycle-intent.entity";
import { TonCenterV3Service } from "./ton-center-v3.service";
import {
  buildTonNativeLifecyclePayload,
  parseTonNativeLifecyclePayload,
  TON_NATIVE_CONTRACT_STATUS,
  TonNativeLifecycleAction,
} from "./ton-native-lifecycle";
import { TonNativeLifecycleIngestionService } from "./ton-native-lifecycle-ingestion.service";

describe("TonNativeLifecycleIngestionService", () => {
  it("applies a finalized delivery intent and retains the active watch", async () => {
    const dealId = "30000000-0000-4000-8000-000000000001";
    const preparationId = "40000000-0000-4000-8000-000000000001";
    const sellerId = "20000000-0000-4000-8000-000000000001";
    const escrow = `0:${"11".repeat(32)}`;
    const seller = `0:${"22".repeat(32)}`;
    const queryId = 42n;
    const code = beginCell().storeUint(1, 1).endCell();
    const config = beginCell().storeUint(2, 2).endCell();
    const payload = buildTonNativeLifecyclePayload(
      TonNativeLifecycleAction.MARK_DELIVERED,
      queryId,
    );
    const preparation = Object.assign(new TonNativeEscrowPreparation(), {
      id: preparationId,
      dealId,
      network: TonNetwork.TESTNET,
      escrowAddress: escrow,
      buyerAddress: `0:${"33".repeat(32)}`,
      sellerAddress: seller,
      treasuryAddress: `0:${"44".repeat(32)}`,
      buyerTotalAtomic: "2000000000",
      sellerPayoutAtomic: "1900000000",
      platformFeeAtomic: "100000000",
      refundToBuyerAtomic: "2000000000",
      refundFeeAtomic: "0",
      deliveryDeadline: "1900001000",
      confirmationDeadline: "1900002000",
      codeHash: code.hash().toString("hex"),
      configHash: config.hash().toString("hex"),
      createdAt: new Date("2030-01-01T00:00:00Z"),
    });
    const intent = Object.assign(new TonNativeLifecycleIntent(), {
      id: "50000000-0000-4000-8000-000000000001",
      preparationId,
      dealId,
      action: TonNativeLifecycleAction.MARK_DELIVERED,
      expectedFromStatus: TON_NATIVE_CONTRACT_STATUS.FUNDED,
      expectedToStatus: TON_NATIVE_CONTRACT_STATUS.DELIVERED,
      requesterUserId: sellerId,
      senderAddress: seller,
      queryId: queryId.toString(),
      actionValueAtomic: "50000000",
      payload,
      payloadHash: parseTonNativeLifecyclePayload(payload).hash,
      reason: null,
      consumedAt: null,
      consumedByEventId: null,
    });
    const watch = {
      id: "60000000-0000-4000-8000-000000000001",
      preparationId,
      status: TonNativeEscrowWatchStatus.FUNDED,
      lastFinalizedLt: "100",
      preparation,
    } as any;
    const state = beginCell()
      .storeUint(TON_NATIVE_CONTRACT_STATUS.DELIVERED, 8)
      .storeCoins(2_000_000_000n)
      .storeUint(queryId, 64)
      .storeRef(config)
      .endCell();
    const tonCenter = {
      isEnabled: jest.fn().mockReturnValue(true),
      listFinalizedTransactions: jest.fn().mockResolvedValue([
        {
          account: escrow,
          account_state_after: {
            account_status: "active",
            code_hash: code.hash().toString("base64"),
            data_boc: state.toBoc().toString("base64"),
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
            source: seller,
            destination: escrow,
            value: "50000000",
            hash: "msg-hash",
            message_content: { body: payload },
          },
          out_msgs: [],
          lt: "101",
          mc_block_seqno: 99,
          now: 1_900_000_000,
        },
      ]),
    } as unknown as TonCenterV3Service;
    const dealService = {
      applyFinalizedNativeTonLifecycle: jest.fn().mockResolvedValue({}),
    } as unknown as DealService;
    const ledger = {
      recordNativeTonSettlement: jest.fn().mockResolvedValue(undefined),
    } as unknown as MoneyLedgerService;
    const watchRepo = {
      find: jest.fn().mockResolvedValue([watch]),
      findOneOrFail: jest.fn().mockResolvedValue(watch),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;
    const preparationRepo = {
      findOneOrFail: jest.fn().mockResolvedValue(preparation),
    } as any;
    const intentRepo = {
      findOne: jest.fn().mockResolvedValue(intent),
      findOneOrFail: jest.fn().mockResolvedValue(intent),
      save: jest.fn(async (value) => value),
    } as any;
    let storedEvent: any = null;
    const eventRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockImplementation(async () => storedEvent),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        storedEvent = { id: "event-id", ...value };
        return storedEvent;
      }),
    } as any;
    const applyLock = {
      run: jest.fn(async (_id, handler) => ({
        status: "acquired",
        value: await handler(storedEvent, {
          getRepository: () => eventRepo,
        }),
      })),
    } as any;
    const reconciliation = {
      assertReconciled: jest.fn().mockResolvedValue(null),
    } as any;
    const service = new TonNativeLifecycleIngestionService(
      tonCenter,
      dealService,
      ledger,
      watchRepo,
      preparationRepo,
      intentRepo,
      eventRepo,
      applyLock,
      reconciliation,
    );

    const report = await service.runOnce();
    expect(report).toMatchObject({
      watchesScanned: 1,
      observed: 1,
      accepted: 1,
      applied: 1,
      rejected: 0,
    });
    expect(storedEvent.outcome).toBe(TonNativeChainEventOutcome.ACCEPTED);
    expect(dealService.applyFinalizedNativeTonLifecycle).toHaveBeenCalledWith(
      dealId,
      TonNativeLifecycleAction.MARK_DELIVERED,
      sellerId,
      null,
      undefined,
    );
    expect(watchRepo.update).toHaveBeenCalledWith(
      { preparationId },
      expect.objectContaining({ status: TonNativeEscrowWatchStatus.FUNDED }),
    );
  });

  it("keeps a lifecycle event retryable when intent persistence fails after the deal transition", async () => {
    const preparation = Object.assign(new TonNativeEscrowPreparation(), {
      id: "40000000-0000-4000-8000-000000000010",
      dealId: "30000000-0000-4000-8000-000000000010",
      buyerAddress: `0:${"11".repeat(32)}`,
      sellerAddress: `0:${"22".repeat(32)}`,
      treasuryAddress: `0:${"33".repeat(32)}`,
      sellerPayoutAtomic: "970000000",
      platformFeeAtomic: "30000000",
      refundToBuyerAtomic: "1000000000",
      refundFeeAtomic: "0",
    });
    const intent = Object.assign(new TonNativeLifecycleIntent(), {
      id: "50000000-0000-4000-8000-000000000010",
      preparationId: preparation.id,
      dealId: preparation.dealId,
      action: TonNativeLifecycleAction.RELEASE,
      requesterUserId: "buyer-1",
      reason: null,
      buyerAwardAtomic: null,
      sellerAwardAtomic: null,
      consumedAt: null,
      consumedByEventId: null,
    });
    const event = {
      id: "event-intent-write-failure",
      preparationId: preparation.id,
      dealId: preparation.dealId,
      intentId: intent.id,
      transactionHash: "tx-release",
      transactionLt: "501",
      applyAttempts: 0,
      appliedAt: null,
      automationStoppedAt: null,
      lastApplyError: null,
      reconciledAt: null,
      reconciliationSource: null,
      reconciliationEvidence: null,
      reconciliationError: null,
    } as any;
    const eventRepo = { save: jest.fn(async (value) => value) } as any;
    const intentRepo = {
      findOneOrFail: jest.fn().mockResolvedValue(intent),
      save: jest
        .fn()
        .mockRejectedValue(new Error("intent storage unavailable")),
    } as any;
    const dealService = {
      applyFinalizedNativeTonLifecycle: jest.fn().mockResolvedValue({}),
    } as unknown as DealService;
    const ledger = {
      recordNativeTonSettlement: jest.fn().mockResolvedValue(undefined),
    } as unknown as MoneyLedgerService;
    const watchRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;
    const service = new TonNativeLifecycleIngestionService(
      {} as TonCenterV3Service,
      dealService,
      ledger,
      watchRepo,
      { findOneOrFail: jest.fn().mockResolvedValue(preparation) } as any,
      intentRepo,
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

    expect(ledger.recordNativeTonSettlement).toHaveBeenCalledTimes(1);
    expect(dealService.applyFinalizedNativeTonLifecycle).toHaveBeenCalledTimes(
      1,
    );
    expect(event.appliedAt).toBeNull();
    expect(event.lastApplyError).toBe("intent storage unavailable");
    expect(watchRepo.update).not.toHaveBeenCalled();
  });
});
