import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { TonEscrowAdapter } from "../escrow/adapters/ton-escrow.adapter";
import {
  TonNetwork,
  TonWalletBinding,
} from "../user/entities/ton-wallet-binding.entity";
import { Deal } from "./entities/deal.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import { TonNativeLifecycleIntent } from "./entities/ton-native-lifecycle-intent.entity";
import {
  Currency,
  DealStatus,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "./enums/deal.enum";
import { TonNativeLifecycleRequestService } from "./ton-native-lifecycle-request.service";
import {
  parseTonNativeLifecyclePayload,
  TON_NATIVE_CONTRACT_STATUS,
  TonNativeLifecycleAction,
} from "./ton-native-lifecycle";

describe("TonNativeLifecycleRequestService", () => {
  const buyerId = "10000000-0000-4000-8000-000000000001";
  const sellerId = "20000000-0000-4000-8000-000000000001";
  const dealId = "30000000-0000-4000-8000-000000000001";
  const preparationId = "40000000-0000-4000-8000-000000000001";
  const buyerAddress = `0:${"11".repeat(32)}`;
  const sellerAddress = `0:${"22".repeat(32)}`;
  const escrowAddress = `0:${"33".repeat(32)}`;

  function setup(input?: {
    status?: DealStatus;
    existingIntent?: TonNativeLifecycleIntent | null;
    ready?: boolean;
  }) {
    const deal = Object.assign(new Deal(), {
      id: dealId,
      buyerId,
      sellerId,
      status: input?.status ?? DealStatus.IN_PROGRESS,
      settlementNetwork: SettlementNetwork.TON,
      settlementMode: SettlementMode.NATIVE,
      settlementAsset: SettlementAsset.TON_NATIVE,
      settlementChainId: "testnet",
      currency: Currency.TON,
      quoteId: preparationId,
      fundedAt: new Date(),
    });
    const preparation = Object.assign(new TonNativeEscrowPreparation(), {
      id: preparationId,
      dealId,
      network: TonNetwork.TESTNET,
      escrowAddress,
      buyerAddress,
      sellerAddress,
      deliveryDeadline: "1900001000",
      confirmationDeadline: "1900002000",
    });
    let savedIntent: TonNativeLifecycleIntent | null =
      input?.existingIntent ?? null;
    const manager = {
      findOne: jest.fn(async (entity) => {
        if (entity === Deal) return deal;
        if (entity === TonNativeEscrowPreparation) return preparation;
        if (entity === TonWalletBinding) {
          return Object.assign(new TonWalletBinding(), {
            userId: sellerId,
            network: TonNetwork.TESTNET,
            address: sellerAddress,
          });
        }
        if (entity === TonNativeLifecycleIntent) return savedIntent;
        return null;
      }),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (value) => {
        savedIntent = Object.assign(new TonNativeLifecycleIntent(), {
          id: "50000000-0000-4000-8000-000000000001",
          ...value,
        });
        return savedIntent;
      }),
    };
    const dataSource = {
      options: { type: "sqlite" },
      transaction: jest.fn(async (work) => work(manager)),
    } as unknown as DataSource;
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService;
    const adapter = {
      isReady: jest.fn().mockReturnValue(input?.ready ?? true),
    } as unknown as TonEscrowAdapter;
    return {
      service: new TonNativeLifecycleRequestService(
        dataSource,
        config,
        adapter,
      ),
      manager,
      preparation,
      getIntent: () => savedIntent,
    };
  }

  it("builds and persists an exact seller MarkDelivered request", async () => {
    const { service, getIntent } = setup();
    const result = await service.buildRequest(
      dealId,
      sellerId,
      TonNativeLifecycleAction.MARK_DELIVERED,
      undefined,
      1_900_000_000,
    );

    expect(result.expectedFromStatus).toBe(TON_NATIVE_CONTRACT_STATUS.FUNDED);
    expect(result.expectedToStatus).toBe(TON_NATIVE_CONTRACT_STATUS.DELIVERED);
    expect(result.transaction.from).toBe(sellerAddress);
    expect(result.transaction.messages).toEqual([
      expect.objectContaining({
        address: escrowAddress,
        amount: "50000000",
      }),
    ]);
    const decoded = parseTonNativeLifecyclePayload(
      result.transaction.messages[0].payload!,
    );
    expect(decoded.action).toBe(TonNativeLifecycleAction.MARK_DELIVERED);
    expect(decoded.queryId.toString()).toBe(result.queryId);
    expect(getIntent()?.payloadHash).toBe(decoded.hash);
  });

  it("rejects a buyer attempting a seller-only action", async () => {
    const { service } = setup();
    await expect(
      service.buildRequest(
        dealId,
        buyerId,
        TonNativeLifecycleAction.MARK_DELIVERED,
        undefined,
        1_900_000_000,
      ),
    ).rejects.toThrow("Only the seller");
  });

  it("rejects a timeout action before the committed deadline", async () => {
    const { service } = setup();
    await expect(
      service.buildRequest(
        dealId,
        sellerId,
        TonNativeLifecycleAction.REFUND_AFTER_SELLER_TIMEOUT,
        undefined,
        1_900_000_000,
      ),
    ).rejects.toThrow("not available yet");
  });

  it("keeps real lifecycle requests behind the adapter gate", async () => {
    const { service } = setup({ ready: false });
    await expect(
      service.buildRequest(
        dealId,
        sellerId,
        TonNativeLifecycleAction.MARK_DELIVERED,
      ),
    ).rejects.toThrow("not enabled yet");
  });

  it("creates one durable intent after a transaction save failure and retry", async () => {
    const { service, manager, getIntent } = setup();
    (manager.save as jest.Mock).mockRejectedValueOnce(
      new Error("simulated transaction rollback"),
    );

    await expect(
      service.buildRequest(
        dealId,
        sellerId,
        TonNativeLifecycleAction.MARK_DELIVERED,
        undefined,
        1_900_000_000,
      ),
    ).rejects.toThrow("simulated transaction rollback");
    expect(getIntent()).toBeNull();

    const retry = await service.buildRequest(
      dealId,
      sellerId,
      TonNativeLifecycleAction.MARK_DELIVERED,
      undefined,
      1_900_000_000,
    );

    expect(retry.intentId).toBe("50000000-0000-4000-8000-000000000001");
    expect(getIntent()?.id).toBe(retry.intentId);
    expect(manager.save).toHaveBeenCalledTimes(2);
  });
});
