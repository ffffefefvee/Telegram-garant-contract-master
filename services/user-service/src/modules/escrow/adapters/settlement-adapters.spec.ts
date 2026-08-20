import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ethers } from "ethers";
import { ConfigService } from "@nestjs/config";
import { BlockchainConfig } from "../../blockchain/blockchain.config";
import { FeeModel as ContractFeeModel } from "../../blockchain/blockchain.types";
import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../../deal/enums/deal.enum";
import { EscrowService } from "../escrow.service";
import { PolygonEscrowAdapter } from "./polygon-escrow.adapter";
import { SettlementAdapterRegistry } from "./settlement-adapter.registry";
import { TonEscrowAdapter } from "./ton-escrow.adapter";

const BUYER = `0x${"a".repeat(40)}`;
const SELLER = `0x${"b".repeat(40)}`;
const TOKEN = `0x${"c".repeat(40)}`;
const ESCROW = `0x${"d".repeat(40)}`;
const emptyTonConfig = {
  get: jest.fn((_key: string, fallback: unknown) => fallback),
} as unknown as ConfigService;

describe("settlement adapters", () => {
  const escrow = {
    isEnabled: jest.fn(() => true),
    createEscrow: jest.fn(async () => ({
      dealId: "deal-1",
      escrowAddress: ESCROW,
      transactionHash: `0x${"1".repeat(64)}`,
      buyerFee: 2_500_000n,
      sellerFee: 0n,
    })),
    getSummary: jest.fn(),
  } as unknown as EscrowService;
  const config = {
    chainId: 137,
    tokenAddress: TOKEN,
  } as BlockchainConfig;

  beforeEach(() => jest.clearAllMocks());

  it("prepares a Polygon escrow without changing network or asset", async () => {
    const adapter = new PolygonEscrowAdapter(escrow, config);
    const result = await adapter.prepareEscrow({
      dealId: "deal-1",
      chainId: "137",
      asset: SettlementAsset.POLYGON_USDT,
      buyerAddress: BUYER,
      sellerAddress: SELLER,
      amount: 100,
      feeModel: FeeModel.BUYER_PAYS,
    });

    expect(result).toMatchObject({
      network: SettlementNetwork.POLYGON,
      chainId: "137",
      asset: SettlementAsset.POLYGON_USDT,
      assetContract: ethers.getAddress(TOKEN),
      escrowAddress: ethers.getAddress(ESCROW),
    });
    expect(escrow.createEscrow).toHaveBeenCalledWith(
      "deal-1",
      ethers.getAddress(BUYER),
      ethers.getAddress(SELLER),
      100,
      ContractFeeModel.BUYER_100,
      undefined,
    );
  });

  it("rejects a Polygon request for the wrong configured chain", () => {
    const adapter = new PolygonEscrowAdapter(escrow, config);
    expect(() =>
      adapter.assertSupports("80002", SettlementAsset.POLYGON_USDT),
    ).toThrow(BadRequestException);
  });

  it("keeps the TON adapter fail-closed until native escrow exists", async () => {
    const adapter = new TonEscrowAdapter(emptyTonConfig);
    expect(adapter.isReady()).toBe(false);
    expect(adapter.isNativeArtifactVerified()).toBe(false);
    await expect(
      adapter.prepareEscrow({
        dealId: "deal-1",
        chainId: "mainnet",
        asset: SettlementAsset.TON_USDT,
        buyerAddress: "EQbuyer",
        sellerAddress: "EQseller",
        amount: 100,
        feeModel: FeeModel.SPLIT_50_50,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("resolves adapters by immutable settlement network", () => {
    const polygon = new PolygonEscrowAdapter(escrow, config);
    const ton = new TonEscrowAdapter(emptyTonConfig);
    const registry = new SettlementAdapterRegistry(polygon, ton);

    expect(registry.get(SettlementNetwork.POLYGON)).toBe(polygon);
    expect(registry.get(SettlementNetwork.TON)).toBe(ton);
  });
});
