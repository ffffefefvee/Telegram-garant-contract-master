import { beginCell, contractAddress } from "@ton/ton";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager } from "typeorm";
import { Deal } from "./entities/deal.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import {
  Currency,
  DealStatus,
  FeeModel,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "./enums/deal.enum";
import {
  TonNetwork,
  TonWalletBinding,
} from "../user/entities/ton-wallet-binding.entity";
import { TonEscrowAdapter } from "../escrow/adapters/ton-escrow.adapter";
import { TonNativeEscrowComposer } from "../escrow/adapters/ton-native-escrow-composer";
import {
  computeNativeTonEconomics,
  decimalTonToNano,
  TonNativeFundingService,
} from "./ton-native-funding.service";

function address(seed: number): string {
  return contractAddress(0, {
    code: beginCell().storeUint(seed, 16).endCell(),
    data: beginCell()
      .storeUint(seed + 1, 16)
      .endCell(),
  }).toRawString();
}

describe("native TON amount conversion", () => {
  it("converts exact decimal TON values without floating-point arithmetic", () => {
    expect(decimalTonToNano("10.500000001")).toBe(10_500_000_001n);
    expect(decimalTonToNano(5)).toBe(5_000_000_000n);
  });

  it("rejects scientific notation and sub-nanoton values", () => {
    expect(() => decimalTonToNano("1e-7")).toThrow(/exact decimal/);
    expect(() => decimalTonToNano("0.0000000001")).toThrow(/9 decimal/);
  });

  it.each([
    [FeeModel.BUYER_PAYS, "10.5", "10", "0.5"],
    [FeeModel.SELLER_PAYS, "10", "9.5", "0.5"],
    [FeeModel.SPLIT_50_50, "10.25", "9.75", "0.5"],
  ])("conserves value for %s", (model, buyer, seller, fee) => {
    const result = computeNativeTonEconomics("10", "0.5", model);
    expect(result).toEqual({
      buyerTotal: decimalTonToNano(buyer),
      sellerPayout: decimalTonToNano(seller),
      platformFee: decimalTonToNano(fee),
    });
  });
});

describe("TonNativeFundingService", () => {
  const now = 1_700_000_000;
  const dealId = "00000000-0000-4000-8000-000000000111";
  const buyerId = "00000000-0000-4000-8000-000000000001";
  const sellerId = "00000000-0000-4000-8000-000000000002";
  const buyerAddress = address(1);
  const sellerAddress = address(2);
  const arbitratorAddress = address(3);
  const treasuryAddress = address(4);
  const code = beginCell().storeUint(0xabcdef, 24).endCell();
  const configValues: Record<string, string> = {
    TON_CONNECT_NETWORK: TonNetwork.TESTNET,
    TON_NATIVE_TREASURY_ADDRESS: treasuryAddress,
    TON_NATIVE_ARBITRATOR_ADDRESS: arbitratorAddress,
    TON_NATIVE_FUNDING_WINDOW_SECONDS: "900",
    TON_NATIVE_CONFIRMATION_WINDOW_SECONDS: "259200",
    TON_NATIVE_TRANSACTION_TTL_SECONDS: "300",
    TON_NATIVE_REFUND_FEE_NANO: "0",
  };

  function setup(ready = true) {
    const adapter = {
      isReady: jest.fn().mockReturnValue(ready),
      nativeArtifact: {
        verified: true,
        reason: "verified",
        codeHash: code.hash().toString("hex"),
        bocHex: code.toBoc().toString("hex"),
        minOperationalReserveNano: "200000000",
      },
    } as unknown as TonEscrowAdapter;
    const composer = new TonNativeEscrowComposer(adapter);
    const config = {
      get: jest.fn(
        (key: string, fallback?: string) => configValues[key] ?? fallback,
      ),
    } as unknown as ConfigService;
    let stored: TonNativeEscrowPreparation | null = null;
    const deal = {
      id: dealId,
      buyerId,
      sellerId,
      status: DealStatus.PENDING_PAYMENT,
      settlementNetwork: SettlementNetwork.TON,
      settlementMode: SettlementMode.NATIVE,
      settlementAsset: SettlementAsset.TON_NATIVE,
      settlementChainId: "testnet",
      currency: Currency.TON,
      termsHash: "1".repeat(64),
      deadline: new Date((now + 10_000) * 1_000),
      amount: "10",
      commissionAmount: "0.5",
      feeModel: FeeModel.BUYER_PAYS,
    } as unknown as Deal;
    const manager = {
      findOne: jest.fn(async (entity, options) => {
        if (entity === Deal) return deal;
        if (entity === TonWalletBinding) {
          return options.where.userId === buyerId
            ? {
                userId: buyerId,
                network: TonNetwork.TESTNET,
                address: buyerAddress,
              }
            : {
                userId: sellerId,
                network: TonNetwork.TESTNET,
                address: sellerAddress,
              };
        }
        if (entity === TonNativeEscrowPreparation) return stored;
        return null;
      }),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (value) => {
        stored = { createdAt: new Date(), ...value };
        return stored;
      }),
      update: jest.fn(async (_entity, _criteria, changes) => {
        Object.assign(deal, changes);
        return { affected: 1 };
      }),
    } as unknown as EntityManager;
    const dataSource = {
      options: { type: "sqlite" },
      transaction: jest.fn(async (callback) => callback(manager)),
    } as unknown as DataSource;
    const service = new TonNativeFundingService(
      dataSource,
      config,
      adapter,
      composer,
    );
    return { service, manager, adapter, getStored: () => stored };
  }

  it("keeps the external request hard-disabled while the adapter is not ready", async () => {
    const { service, manager } = setup(false);
    await expect(
      service.buildFundingRequest(dealId, buyerId, now),
    ).rejects.toThrow(/not enabled/);
    expect(manager.findOne).not.toHaveBeenCalled();
  });

  it("locks an immutable quote and returns one exact deploy-and-fund message", async () => {
    const { service, manager, getStored } = setup();
    const response = await service.buildFundingRequest(dealId, buyerId, now);

    expect(response.buyerTotalAtomic).toBe("10500000000");
    expect(response.sellerPayoutAtomic).toBe("10000000000");
    expect(response.platformFeeAtomic).toBe("500000000");
    expect(response.refundToBuyerAtomic).toBe("10500000000");
    expect(response.operationalReserveAtomic).toBe("200000000");
    expect(response.transaction).toMatchObject({
      validUntil: now + 300,
      network: TonNetwork.TESTNET,
      from: buyerAddress,
      messages: [
        {
          address: response.escrowAddress,
          amount: "10700000000",
          payload: expect.any(String),
          stateInit: expect.any(String),
        },
      ],
    });
    expect(getStored()?.quoteHash).toBe(response.quoteHash);
    expect(manager.update).toHaveBeenCalledWith(
      Deal,
      { id: dealId, status: DealStatus.PENDING_PAYMENT },
      expect.objectContaining({
        quoteId: response.quoteId,
        escrowAddress: response.escrowAddress,
        buyerWalletAddress: buyerAddress,
        sellerWalletAddress: sellerAddress,
      }),
    );
  });

  it("reuses the immutable preparation while refreshing only validUntil", async () => {
    const { service, manager } = setup();
    const first = await service.buildFundingRequest(dealId, buyerId, now);
    const second = await service.buildFundingRequest(dealId, buyerId, now + 1);

    expect(second.quoteId).toBe(first.quoteId);
    expect(second.quoteHash).toBe(first.quoteHash);
    expect(second.escrowAddress).toBe(first.escrowAddress);
    expect(second.transaction.validUntil).toBe(
      first.transaction.validUntil + 1,
    );
    expect((manager.create as jest.Mock).mock.calls).toHaveLength(1);
  });
});
