import { BlockchainConfig } from "./blockchain.config";
import { PolygonFinalityService } from "./polygon-finality.service";
import {
  expectedLiabilities,
  PolygonReconciliationService,
} from "./polygon-reconciliation.service";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { DataSource } from "typeorm";
import { RelayService } from "./relay.service";

const DEAL_ID = "a58efcd0-e533-4f75-a58f-b244af24c612";
const ESCROW = "0x0000000000000000000000000000000000000011";
const TOKEN = "0x0000000000000000000000000000000000000012";
const BUYER = "0x0000000000000000000000000000000000000013";
const SELLER = "0x0000000000000000000000000000000000000014";
const ANCHOR = {
  chainId: 80002,
  blockNumber: 100,
  blockHash: "0x" + "a".repeat(64),
  evidenceHash: "b".repeat(64),
  sources: 2,
};

function harness(overrides: { balance?: string; dealId?: string; enabled?: boolean } = {}) {
  const save = jest.fn().mockResolvedValue(undefined);
  const db = {
    isInitialized: true,
    query: jest.fn().mockResolvedValue([
      {
        deal_id: DEAL_ID,
        escrow_address: ESCROW,
        buyer_wallet_address: BUYER,
        seller_wallet_address: SELLER,
        quote_chain_id: "80002",
        quote_asset_contract: TOKEN,
        amount_atomic: "100",
        buyer_fee_atomic: "5",
        total_funding_atomic: "105",
      },
    ]),
    getRepository: jest.fn().mockReturnValue({ save }),
  };
  const finality = {
    finalizedAnchor: jest.fn().mockResolvedValue(ANCHOR),
    relayerBalance: jest.fn().mockResolvedValue(1_000n),
    readEscrow: jest.fn().mockResolvedValue({
      evidenceHash: "c".repeat(64),
      observation: {
        blockNumber: 100,
        blockHash: ANCHOR.blockHash,
        token: TOKEN,
        dealId: overrides.dealId ?? RelayService.toBytes32(DEAL_ID).toLowerCase(),
        buyer: BUYER,
        seller: SELLER,
        amount: "100",
        buyerFee: "5",
        sellerFee: "0",
        status: 2,
        assignedArbitrator: "0x0000000000000000000000000000000000000000",
        balance: overrides.balance ?? "105",
      },
    }),
  };
  const breakers = {
    tripOnDiscrepancy: jest.fn().mockResolvedValue({ tripped: true }),
    tripChainIncident: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    polygonIndexerEnabled: overrides.enabled ?? true,
    chainId: 80002,
    tokenAddress: TOKEN,
  } as BlockchainConfig;
  return {
    service: new PolygonReconciliationService(
      config,
      finality as unknown as PolygonFinalityService,
      breakers as unknown as SettlementCircuitBreakerService,
      db as unknown as DataSource,
    ),
    db,
    save,
    breakers,
  };
}

describe("PolygonReconciliationService", () => {
  it("records exact finalized identity and balance agreement", async () => {
    const { service, save, breakers } = harness();
    await expect(service.runOnce()).resolves.toEqual({
      anchorBlock: 100,
      scanned: 1,
      matched: 1,
      mismatched: 0,
      relayerBalanceWei: "1000",
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: DEAL_ID,
        assetsAtomic: "105",
        liabilitiesAtomic: "105",
        matches: true,
        reasonCode: null,
      }),
    );
    expect(breakers.tripOnDiscrepancy).not.toHaveBeenCalled();
  });

  it("persists a balance mismatch and trips the Polygon breaker", async () => {
    const { service, save, breakers } = harness({ balance: "104" });
    const report = await service.runOnce();
    expect(report?.mismatched).toBe(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ matches: false, reasonCode: "POLYGON_BALANCE_MISMATCH" }),
    );
    expect(breakers.tripOnDiscrepancy).toHaveBeenCalledWith(
      expect.objectContaining({ assetsAtomic: "104", liabilitiesAtomic: "105" }),
    );
  });

  it("trips a source/identity incident even when the raw balance matches", async () => {
    const { service, breakers } = harness({ dealId: "0x" + "f".repeat(64) });
    await service.runOnce();
    expect(breakers.tripChainIncident).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "POLYGON_DEAL_ID_MISMATCH" }),
    );
  });

  it("does no RPC or database work while the Polygon indexer gate is disabled", async () => {
    const { service, db } = harness({ enabled: false });
    await expect(service.runOnce()).resolves.toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([
    [1, "77", "0"],
    [2, "77", "105"],
    [5, "77", "105"],
    [3, "77", "0"],
    [4, "77", "0"],
    [6, "77", "0"],
    [7, "77", "0"],
    [8, "77", "0"],
  ])("derives exact liabilities for status %s", (status, balance, expected) => {
    expect(expectedLiabilities(status, "105", balance)).toBe(expected);
  });

  it("rejects uninitialized or unknown status rather than guessing liabilities", () => {
    expect(() => expectedLiabilities(0, "105", "0")).toThrow(
      "POLYGON_ESCROW_STATUS_INVALID",
    );
    expect(() => expectedLiabilities(9, "105", "0")).toThrow(
      "POLYGON_ESCROW_STATUS_INVALID",
    );
  });
});
