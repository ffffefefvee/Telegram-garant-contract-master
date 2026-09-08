import { ethers } from "ethers";
import { BlockchainConfig } from "./blockchain.config";
import {
  evidenceHash,
  normalizeObservation,
  PolygonFinalityService,
  PolygonSourceDisagreementError,
} from "./polygon-finality.service";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";

function provider(overrides: Record<string, unknown> = {}) {
  return {
    getNetwork: jest.fn().mockResolvedValue({ chainId: 80002n }),
    getBlockNumber: jest.fn().mockResolvedValue(1000),
    getBlock: jest.fn().mockResolvedValue({ hash: "0x" + "a".repeat(64) }),
    getBalance: jest.fn().mockResolvedValue(200n),
    ...overrides,
  };
}

function harness(providers = [provider(), provider()]) {
  const config = {
    rpcUrls: ["https://rpc-a.example", "https://rpc-b.example"],
    chainId: 80002,
    polygonFinalityConfirmations: 128,
    polygonStartBlock: 100,
    tokenAddress: "0x0000000000000000000000000000000000000001",
    web3SignerAddress: "0x0000000000000000000000000000000000000002",
    polygonRelayerMinimumBalanceWei: 100n,
  } as BlockchainConfig;
  const breakers = { tripChainIncident: jest.fn().mockResolvedValue(undefined) };
  const service = new PolygonFinalityService(
    config,
    breakers as unknown as SettlementCircuitBreakerService,
  );
  (service as unknown as { providers: unknown[] }).providers = providers;
  return { service, breakers, providers };
}

describe("PolygonFinalityService", () => {
  it("selects the lowest independently observed head and requires an exact finalized hash", async () => {
    const providers = [provider(), provider({ getBlockNumber: jest.fn().mockResolvedValue(995) })];
    const { service } = harness(providers);
    await expect(service.finalizedAnchor()).resolves.toEqual({
      chainId: 80002,
      blockNumber: 867,
      blockHash: "0x" + "a".repeat(64),
      evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      sources: 2,
    });
    expect(providers[0].getBlock).toHaveBeenCalledWith(867);
    expect(providers[1].getBlock).toHaveBeenCalledWith(867);
  });

  it("trips the Polygon circuit when finalized block hashes disagree", async () => {
    const { service, breakers } = harness([
      provider(),
      provider({ getBlock: jest.fn().mockResolvedValue({ hash: "0x" + "b".repeat(64) }) }),
    ]);
    await expect(service.finalizedAnchor()).rejects.toBeInstanceOf(
      PolygonSourceDisagreementError,
    );
    expect(breakers.tripChainIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "POLYGON_FINALIZED_HASH",
        evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("fails closed if fewer than two RPC sources are configured", async () => {
    const { service } = harness([provider()]);
    await expect(service.finalizedAnchor()).rejects.toThrow(
      "POLYGON_INDEPENDENT_RPC_UNAVAILABLE",
    );
  });

  it("requires exact independent relayer balances and enforces the gas floor", async () => {
    const { service } = harness();
    const anchor = await service.finalizedAnchor();
    await expect(service.relayerBalance(anchor)).resolves.toBe(200n);

    const disagreement = harness([
      provider({ getBalance: jest.fn().mockResolvedValue(200n) }),
      provider({ getBalance: jest.fn().mockResolvedValue(201n) }),
    ]);
    const secondAnchor = await disagreement.service.finalizedAnchor();
    await expect(disagreement.service.relayerBalance(secondAnchor)).rejects.toBeInstanceOf(
      PolygonSourceDisagreementError,
    );
  });

  it("canonicalizes addresses and produces order-independent evidence hashes", () => {
    const observation = normalizeObservation({
      blockNumber: 10,
      blockHash: "0x" + "A".repeat(64),
      token: "0x0000000000000000000000000000000000000001",
      dealId: "0x" + "B".repeat(64),
      buyer: "0x0000000000000000000000000000000000000002",
      seller: "0x0000000000000000000000000000000000000003",
      amount: "100",
      buyerFee: "5",
      sellerFee: "5",
      status: 2,
      assignedArbitrator: ethers.ZeroAddress,
      balance: "105",
    });
    expect(observation.blockHash).toBe("0x" + "a".repeat(64));
    expect(observation.dealId).toBe("0x" + "b".repeat(64));
    expect(evidenceHash({ b: 2, a: 1 })).toBe(evidenceHash({ a: 1, b: 2 }));
  });
});
