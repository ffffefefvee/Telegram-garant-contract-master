import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";
import { BlockchainConfig } from "../../blockchain/blockchain.config";
import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../../deal/enums/deal.enum";
import { EscrowService } from "../escrow.service";
import {
  EscrowChainAdapter,
  EscrowOperationContext,
} from "./escrow-chain-adapter";
import {
  ChainTransactionReference,
  hashQuoteVersion,
  MULTICHAIN_DOMAIN_VERSION,
  NormalizedFundingStatus,
  QuoteVersion,
  TermsVersion,
} from "./multichain-domain-contract";
import { PolygonEscrowAdapter } from "./polygon-escrow.adapter";
import { TonEscrowAdapter } from "./ton-escrow.adapter";

const EVM_BUYER = `0x${"a".repeat(40)}`;
const EVM_SELLER = `0x${"b".repeat(40)}`;
const EVM_TOKEN = `0x${"c".repeat(40)}`;
const EVM_ESCROW = `0x${"d".repeat(40)}`;
const TON_BUYER = `0:${"a".repeat(64)}`;
const TON_SELLER = `0:${"b".repeat(64)}`;
const TON_MASTER = `0:${"c".repeat(64)}`;
const TON_ESCROW = `0:${"d".repeat(64)}`;

const TERMS: TermsVersion = {
  domainVersion: MULTICHAIN_DOMAIN_VERSION,
  version: 4,
  hash: "1".repeat(64),
};

function quote(input: {
  network: SettlementNetwork;
  chainId: string;
  asset: SettlementAsset;
  assetContract: string | null;
}): QuoteVersion {
  const unsigned: Omit<QuoteVersion, "hash"> = {
    domainVersion: MULTICHAIN_DOMAIN_VERSION,
    quoteId: "11111111-1111-4111-8111-111111111111",
    version: 1,
    termsVersion: TERMS.version,
    termsHash: TERMS.hash,
    feeModel: FeeModel.BUYER_PAYS,
    network: input.network,
    chainId: input.chainId,
    asset: input.asset,
    assetContract: input.assetContract,
    decimals: 6,
    amountAtomic: "100000000",
    buyerFeeAtomic: "5000000",
    sellerFeeAtomic: "0",
    totalFundingAtomic: "105000000",
    sellerReceivesAtomic: "100000000",
    createdAt: "2099-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T01:00:00.000Z",
  };
  return { ...unsigned, hash: hashQuoteVersion(unsigned) };
}

function context(input: AdapterCase): EscrowOperationContext {
  const persistedQuote = quote(input);
  return {
    domainVersion: MULTICHAIN_DOMAIN_VERSION,
    dealId: "deal-1",
    network: input.network,
    chainId: input.chainId,
    asset: input.asset,
    assetContract: input.assetContract,
    decimals: 6,
    escrowAddress: input.escrowAddress,
    terms: TERMS,
    quote: persistedQuote,
  };
}

function transaction(input: AdapterCase): ChainTransactionReference {
  return {
    domainVersion: MULTICHAIN_DOMAIN_VERSION,
    network: input.network,
    chainId: input.chainId,
    asset: input.asset,
    assetContract: input.assetContract,
    decimals: 6,
    hash:
      input.network === SettlementNetwork.POLYGON
        ? `0x${"2".repeat(64)}`
        : "2".repeat(64),
    blockNumber: input.network === SettlementNetwork.POLYGON ? "123456" : null,
    blockHash:
      input.network === SettlementNetwork.POLYGON
        ? `0x${"3".repeat(64)}`
        : "3".repeat(64),
    logicalTime: input.network === SettlementNetwork.TON ? "987654321" : null,
  };
}

interface AdapterCase {
  name: string;
  network: SettlementNetwork;
  chainId: string;
  asset: SettlementAsset;
  assetContract: string | null;
  buyerAddress: string;
  sellerAddress: string;
  escrowAddress: string;
  invalidAddress: string;
  create: () => EscrowChainAdapter;
  ready: boolean;
}

const polygonEscrow = {
  isEnabled: jest.fn(() => true),
  createEscrow: jest.fn(async () => ({
    dealId: "deal-1",
    escrowAddress: EVM_ESCROW,
    transactionHash: `0x${"4".repeat(64)}`,
    buyerFee: 5_000_000n,
    sellerFee: 0n,
  })),
  getSummary: jest.fn(async () => ({
    address: EVM_ESCROW,
    status: "funded" as const,
    buyer: EVM_BUYER,
    seller: EVM_SELLER,
    amount: 100_000_000n,
    buyerFee: 5_000_000n,
    sellerFee: 0n,
    fundingDeadline: 4_071_763_200,
    assignedArbitrator: ethers.ZeroAddress,
    balance: 105_000_000n,
  })),
} as unknown as EscrowService;
const polygonConfig = {
  chainId: 80002,
  tokenAddress: EVM_TOKEN,
} as BlockchainConfig;
const emptyTonConfig = {
  get: jest.fn((_key: string, fallback: unknown) => fallback),
} as unknown as ConfigService;

const CASES: AdapterCase[] = [
  {
    name: "Polygon",
    network: SettlementNetwork.POLYGON,
    chainId: "80002",
    asset: SettlementAsset.POLYGON_USDT,
    assetContract: ethers.getAddress(EVM_TOKEN),
    buyerAddress: EVM_BUYER,
    sellerAddress: EVM_SELLER,
    escrowAddress: EVM_ESCROW,
    invalidAddress: ethers.ZeroAddress,
    create: () => new PolygonEscrowAdapter(polygonEscrow, polygonConfig),
    ready: true,
  },
  {
    name: "TON",
    network: SettlementNetwork.TON,
    chainId: "testnet",
    asset: SettlementAsset.TON_USDT,
    assetContract: TON_MASTER,
    buyerAddress: TON_BUYER,
    sellerAddress: TON_SELLER,
    escrowAddress: TON_ESCROW,
    invalidAddress: "EQ-invalid",
    create: () => new TonEscrowAdapter(emptyTonConfig),
    ready: false,
  },
];

describe.each(CASES)("$name settlement adapter conformance", (adapterCase) => {
  let adapter: EscrowChainAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = adapterCase.create();
  });

  it("declares one immutable network and supported asset tuple", () => {
    expect(adapter.network).toBe(adapterCase.network);
    expect(adapter.isReady()).toBe(adapterCase.ready);
    expect(() =>
      adapter.assertSupports(adapterCase.chainId, adapterCase.asset),
    ).not.toThrow();
  });

  it("canonicalizes valid addresses and rejects invalid addresses", () => {
    expect(adapter.normalizeAddress(adapterCase.buyerAddress)).toBeTruthy();
    expect(() => adapter.normalizeAddress(adapterCase.invalidAddress)).toThrow(
      BadRequestException,
    );
  });

  it("rejects a cross-network asset at the adapter boundary", () => {
    const wrongAsset =
      adapterCase.network === SettlementNetwork.TON
        ? SettlementAsset.POLYGON_USDT
        : SettlementAsset.TON_USDT;
    expect(() =>
      adapter.assertSupports(adapterCase.chainId, wrongAsset),
    ).toThrow(BadRequestException);
  });

  it("does not claim cryptographic funding finality", async () => {
    const result = await adapter.verifyFunding({
      context: context(adapterCase),
      transaction: transaction(adapterCase),
      now: new Date("2099-01-01T00:30:00.000Z"),
    });
    expect(result.network).toBe(adapterCase.network);
    expect(result.chainId).toBe(adapterCase.chainId);
    expect(result.asset).toBe(adapterCase.asset);
    expect(result.finalized).toBe(false);
    expect([
      NormalizedFundingStatus.UNAVAILABLE,
      NormalizedFundingStatus.OBSERVED,
    ]).toContain(result.status);
  });

  it("rejects transaction evidence for a substituted asset contract", async () => {
    const substituted = transaction(adapterCase);
    substituted.assetContract =
      adapterCase.network === SettlementNetwork.POLYGON
        ? `0x${"e".repeat(40)}`
        : `0:${"e".repeat(64)}`;
    await expect(
      adapter.verifyFunding({
        context: context(adapterCase),
        transaction: substituted,
        now: new Date("2099-01-01T00:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("returns normalized reconciliation without authorizing settlement", async () => {
    const result = await adapter.reconcile({
      context: context(adapterCase),
      primaryEvidence: transaction(adapterCase),
      independentEvidence: null,
      now: new Date("2099-01-01T02:00:00.000Z"),
    });
    expect(result.network).toBe(adapterCase.network);
    expect(result.asset).toBe(adapterCase.asset);
    expect(result.finalized).toBe(false);
    expect(result.unavailableReason).toBeTruthy();
  });

  it("rejects mutation of a persisted quote before building funding", async () => {
    const operationContext = context(adapterCase);
    operationContext.quote = {
      ...operationContext.quote,
      totalFundingAtomic: "105000001",
    };
    await expect(
      adapter.buildFundingRequest({
        context: operationContext,
        buyerAddress: adapterCase.buyerAddress,
        now: new Date("2099-01-01T00:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("chain-specific conformance behavior", () => {
  it("builds role-scoped Polygon wallet actions from the persisted quote", async () => {
    const polygon = CASES[0];
    const adapter = polygon.create();
    const operationContext = context(polygon);
    const funding = await adapter.buildFundingRequest({
      context: operationContext,
      buyerAddress: polygon.buyerAddress,
      now: new Date("2099-01-01T00:30:00.000Z"),
    });
    const release = await adapter.release({ context: operationContext });
    const refund = await adapter.refund({ context: operationContext });
    const resolution = await adapter.resolve({
      context: operationContext,
      buyerSharePct: 40,
      sellerSharePct: 60,
    });

    expect(funding).toMatchObject({
      action: "fund",
      signerRole: "buyer",
      network: SettlementNetwork.POLYGON,
      asset: SettlementAsset.POLYGON_USDT,
      amountAtomic: "105000000",
      quoteHash: operationContext.quote.hash,
    });
    expect(release.signerRole).toBe("buyer");
    expect(refund.signerRole).toBe("seller");
    expect(resolution.signerRole).toBe("arbitrator");
  });

  it("keeps every TON money-action request hard-disabled", async () => {
    const ton = CASES[1];
    const adapter = ton.create();
    const operationContext = context(ton);
    await expect(
      adapter.buildFundingRequest({
        context: operationContext,
        buyerAddress: ton.buyerAddress,
        now: new Date("2099-01-01T00:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      adapter.release({ context: operationContext }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      adapter.refund({ context: operationContext }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      adapter.resolve({
        context: operationContext,
        buyerSharePct: 50,
        sellerSharePct: 50,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
