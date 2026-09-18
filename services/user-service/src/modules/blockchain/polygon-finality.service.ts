import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { ethers } from "ethers";
import { BlockchainConfig } from "./blockchain.config";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import {
  SettlementCircuitScope,
  SettlementIncidentKind,
} from "../safety/entities/settlement-circuit-breaker.entity";

const ESCROW_READ_ABI = [
  "function token() view returns (address)",
  "function dealId() view returns (bytes32)",
  "function buyer() view returns (address)",
  "function seller() view returns (address)",
  "function amount() view returns (uint256)",
  "function buyerFee() view returns (uint256)",
  "function sellerFee() view returns (uint256)",
  "function status() view returns (uint8)",
  "function assignedArbitrator() view returns (address)",
  "function getBalance() view returns (uint256)",
];

export interface PolygonFinalizedAnchor {
  chainId: number;
  blockNumber: number;
  blockHash: string;
  evidenceHash: string;
  sources: number;
}

export interface PolygonEscrowObservation {
  blockNumber: number;
  blockHash: string;
  token: string;
  dealId: string;
  buyer: string;
  seller: string;
  amount: string;
  buyerFee: string;
  sellerFee: string;
  status: number;
  assignedArbitrator: string;
  balance: string;
}

export class PolygonSourceDisagreementError extends Error {
  readonly code = "POLYGON_SOURCE_DISAGREEMENT";

  constructor(readonly evidenceHash: string, detail: string) {
    super(`Independent Polygon RPC sources disagree: ${detail}`);
    this.name = PolygonSourceDisagreementError.name;
  }
}

@Injectable()
export class PolygonFinalityService {
  private readonly providers: ethers.JsonRpcProvider[];

  constructor(
    private readonly config: BlockchainConfig,
    private readonly breakers: SettlementCircuitBreakerService,
  ) {
    this.providers = config.rpcUrls.map(
      (url) => new ethers.JsonRpcProvider(url, config.chainId ?? undefined, {
        staticNetwork: config.chainId !== null,
      }),
    );
  }

  get sourceCount(): number {
    return this.providers.length;
  }

  async finalizedAnchor(): Promise<PolygonFinalizedAnchor> {
    this.assertConfigured();
    const networks = await Promise.all(this.providers.map((provider) => provider.getNetwork()));
    const chainIds = networks.map((network) => Number(network.chainId));
    if (chainIds.some((chainId) => chainId !== this.config.chainId)) {
      return this.disagreement("CHAIN_ID", chainIds);
    }
    const heads = await Promise.all(this.providers.map((provider) => provider.getBlockNumber()));
    const minimumHead = Math.min(...heads);
    const finalized = minimumHead - this.config.polygonFinalityConfirmations;
    if (finalized < this.config.polygonStartBlock) {
      throw new Error("POLYGON_FINALITY_NOT_REACHED");
    }
    const blocks = await Promise.all(
      this.providers.map((provider) => provider.getBlock(finalized)),
    );
    if (blocks.some((block) => !block?.hash)) {
      return this.disagreement("MISSING_FINALIZED_BLOCK", blocks.map((block) => block?.hash ?? null));
    }
    const hashes = blocks.map((block) => block!.hash!.toLowerCase());
    if (new Set(hashes).size !== 1) {
      return this.disagreement("FINALIZED_HASH", hashes);
    }
    return {
      chainId: this.config.chainId!,
      blockNumber: finalized,
      blockHash: hashes[0],
      evidenceHash: evidenceHash({ chainId: this.config.chainId, finalized, hash: hashes[0], heads }),
      sources: this.providers.length,
    };
  }

  async readEscrow(
    escrowAddress: string,
    anchor: PolygonFinalizedAnchor,
  ): Promise<{ observation: PolygonEscrowObservation; evidenceHash: string }> {
    if (!ethers.isAddress(escrowAddress) || escrowAddress === ethers.ZeroAddress) {
      throw new Error("INVALID_POLYGON_ESCROW_ADDRESS");
    }
    const observations = await Promise.all(
      this.providers.map(async (provider) => {
        const contract = new ethers.Contract(escrowAddress, ESCROW_READ_ABI, provider);
        const blockTag = anchor.blockNumber;
        const [token, dealId, buyer, seller, amount, buyerFee, sellerFee, status, assigned, balance] =
          await Promise.all([
            contract.token({ blockTag }) as Promise<string>,
            contract.dealId({ blockTag }) as Promise<string>,
            contract.buyer({ blockTag }) as Promise<string>,
            contract.seller({ blockTag }) as Promise<string>,
            contract.amount({ blockTag }) as Promise<bigint>,
            contract.buyerFee({ blockTag }) as Promise<bigint>,
            contract.sellerFee({ blockTag }) as Promise<bigint>,
            contract.status({ blockTag }) as Promise<bigint>,
            contract.assignedArbitrator({ blockTag }) as Promise<string>,
            contract.getBalance({ blockTag }) as Promise<bigint>,
          ]);
        return normalizeObservation({
          blockNumber: anchor.blockNumber,
          blockHash: anchor.blockHash,
          token,
          dealId,
          buyer,
          seller,
          amount: amount.toString(),
          buyerFee: buyerFee.toString(),
          sellerFee: sellerFee.toString(),
          status: Number(status),
          assignedArbitrator: assigned,
          balance: balance.toString(),
        });
      }),
    );
    const serialized = observations.map(canonicalJson);
    if (new Set(serialized).size !== 1) {
      return this.disagreement("ESCROW_STATE", observations);
    }
    if (observations[0].token !== ethers.getAddress(this.config.tokenAddress)) {
      return this.disagreement("TOKEN_ALLOWLIST", {
        expected: ethers.getAddress(this.config.tokenAddress),
        actual: observations[0].token,
      });
    }
    return {
      observation: observations[0],
      evidenceHash: evidenceHash({ anchor: anchor.evidenceHash, escrowAddress, observation: observations[0] }),
    };
  }

  /** Require every configured RPC operator to agree on a historical block hash. */
  async agreedBlockHash(blockNumber: number): Promise<string> {
    this.assertConfigured();
    const blocks = await Promise.all(
      this.providers.map((provider) => provider.getBlock(blockNumber)),
    );
    if (blocks.some((block) => !block?.hash)) {
      return this.disagreement(
        "MISSING_BLOCK_HASH",
        blocks.map((block) => block?.hash ?? null),
      );
    }
    const hashes = blocks.map((block) => block!.hash!.toLowerCase());
    if (new Set(hashes).size !== 1) {
      return this.disagreement("BLOCK_HASH", { blockNumber, hashes });
    }
    return hashes[0];
  }

  /**
   * Read finalized logs from every independent source and require byte-for-byte
   * canonical agreement before any event is persisted or applied.
   */
  async agreedLogs(filter: ethers.Filter): Promise<ethers.Log[]> {
    this.assertConfigured();
    const results = await Promise.all(
      this.providers.map((provider) => provider.getLogs(filter)),
    );
    const canonical = results.map((logs) =>
      canonicalJson(logs.map(normalizeLog).sort(compareCanonicalLogs)),
    );
    if (new Set(canonical).size !== 1) {
      return this.disagreement(
        "FINALIZED_LOGS",
        canonical.map((value) => createHash("sha256").update(value).digest("hex")),
      );
    }
    return [...results[0]].sort(
      (left, right) => left.blockNumber - right.blockNumber || left.index - right.index,
    );
  }

  async relayerBalance(anchor: PolygonFinalizedAnchor): Promise<bigint> {
    const address = this.config.web3SignerAddress;
    if (!ethers.isAddress(address)) throw new Error("POLYGON_RELAYER_ADDRESS_UNAVAILABLE");
    const balances = await Promise.all(
      this.providers.map((provider) => provider.getBalance(address, anchor.blockNumber)),
    );
    if (new Set(balances.map(String)).size !== 1) {
      return this.disagreement("RELAYER_BALANCE", balances.map(String));
    }
    const balance = balances[0];
    if (balance < this.config.polygonRelayerMinimumBalanceWei) {
      throw new Error("POLYGON_RELAYER_BALANCE_BELOW_MINIMUM");
    }
    return balance;
  }

  private assertConfigured(): void {
    if (this.config.chainId === null || this.providers.length < 2) {
      throw new Error("POLYGON_INDEPENDENT_RPC_UNAVAILABLE");
    }
  }

  private async disagreement<T>(kind: string, evidence: unknown): Promise<T> {
    const hash = evidenceHash({ kind, evidence });
    await this.breakers.tripChainIncident({
      scope: SettlementCircuitScope.POLYGON,
      incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
      reasonCode: `POLYGON_${kind}`,
      assetCode: "USDT",
      evidenceHash: hash,
      actorId: "polygon.finality.quorum",
    });
    throw new PolygonSourceDisagreementError(hash, kind);
  }
}

export function normalizeObservation(
  observation: PolygonEscrowObservation,
): PolygonEscrowObservation {
  return {
    ...observation,
    blockHash: observation.blockHash.toLowerCase(),
    token: ethers.getAddress(observation.token),
    dealId: observation.dealId.toLowerCase(),
    buyer: ethers.getAddress(observation.buyer),
    seller: ethers.getAddress(observation.seller),
    assignedArbitrator: ethers.getAddress(observation.assignedArbitrator),
  };
}

export function evidenceHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

interface CanonicalPolygonLog {
  address: string;
  blockHash: string | null;
  blockNumber: number;
  data: string;
  index: number;
  removed: boolean;
  topics: string[];
  transactionHash: string;
  transactionIndex: number;
}

function normalizeLog(log: ethers.Log): CanonicalPolygonLog {
  return {
    address: log.address.toLowerCase(),
    blockHash: log.blockHash?.toLowerCase() ?? null,
    blockNumber: log.blockNumber,
    data: log.data.toLowerCase(),
    index: log.index,
    removed: log.removed,
    topics: [...log.topics].map((topic) => topic.toLowerCase()),
    transactionHash: log.transactionHash.toLowerCase(),
    transactionIndex: log.transactionIndex,
  };
}

function compareCanonicalLogs(left: CanonicalPolygonLog, right: CanonicalPolygonLog): number {
  return left.blockNumber - right.blockNumber || left.index - right.index;
}
