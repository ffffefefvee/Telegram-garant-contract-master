import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";

/**
 * Resolves the on-chain configuration once at startup. Read by all clients in
 * BlockchainModule. If any required env var is missing, `enabled = false` and
 * the module degrades to a stub mode (logs warnings, returns zeros / no-ops)
 * so dev environments without a node still boot.
 */
@Injectable()
export class BlockchainConfig {
  private readonly logger = new Logger(BlockchainConfig.name);

  readonly enabled: boolean;
  readonly rpcUrl: string;
  readonly rpcUrls: string[];
  readonly privateKey: string;
  readonly signerType: "local" | "web3signer" | null;
  readonly web3SignerRpcUrl: string;
  readonly web3SignerAddress: string;
  readonly chainId: number | null;
  readonly polygonIndexerEnabled: boolean;
  readonly polygonFinalityConfirmations: number;
  readonly polygonStartBlock: number;
  readonly polygonLogBatchSize: number;
  readonly polygonRelayerMinimumBalanceWei: bigint;
  readonly polygonRelayTxTimeoutMs: number;
  readonly polygonRelayStuckSeconds: number;
  readonly polygonRelayMaxAttempts: number;

  readonly factoryAddress: string;
  readonly treasuryAddress: string;
  readonly registryAddress: string;
  readonly tokenAddress: string;

  constructor(config: ConfigService) {
    this.rpcUrl = config.get<string>("BLOCKCHAIN_RPC_URL", "");
    this.rpcUrls = this.readRpcUrls(
      this.rpcUrl,
      config.get<string>("BLOCKCHAIN_RPC_URLS", ""),
    );
    this.privateKey = config.get<string>("BLOCKCHAIN_PRIVATE_KEY", "");
    const signerType = config.get<string>("RELAY_SIGNER", "local");
    this.signerType =
      signerType === "local" || signerType === "web3signer" ? signerType : null;
    this.web3SignerRpcUrl = config.get<string>("WEB3SIGNER_RPC_URL", "");
    this.web3SignerAddress = config.get<string>("WEB3SIGNER_ADDRESS", "");
    this.factoryAddress = config.get<string>("ESCROW_FACTORY_ADDRESS", "");
    this.treasuryAddress = config.get<string>("PLATFORM_TREASURY_ADDRESS", "");
    this.registryAddress = config.get<string>(
      "ARBITRATOR_REGISTRY_ADDRESS",
      "",
    );
    this.tokenAddress = config.get<string>("USDT_CONTRACT_ADDRESS", "");
    const chainIdRaw = config.get<string>("BLOCKCHAIN_CHAIN_ID", "");
    const parsedChainId = chainIdRaw ? Number.parseInt(chainIdRaw, 10) : NaN;
    this.chainId =
      Number.isSafeInteger(parsedChainId) && parsedChainId > 0
        ? parsedChainId
        : null;
    this.polygonIndexerEnabled =
      config.get<string | boolean>("POLYGON_INDEXER_ENABLED", false) === true ||
      config.get<string | boolean>("POLYGON_INDEXER_ENABLED", false) === "true";
    this.polygonFinalityConfirmations = this.readInteger(
      config.get<string>("POLYGON_FINALITY_CONFIRMATIONS", "128"),
      1,
      10_000,
      128,
    );
    this.polygonStartBlock = this.readInteger(
      config.get<string>("POLYGON_START_BLOCK", "0"),
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    );
    this.polygonLogBatchSize = this.readInteger(
      config.get<string>("POLYGON_LOG_BATCH_SIZE", "1000"),
      1,
      10_000,
      1000,
    );
    const minimumBalance = config.get<string>(
      "POLYGON_RELAYER_MINIMUM_BALANCE_WEI",
      "0",
    );
    this.polygonRelayerMinimumBalanceWei = /^\d+$/.test(minimumBalance)
      ? BigInt(minimumBalance)
      : 0n;
    this.polygonRelayTxTimeoutMs = this.readInteger(
      config.get<string>("POLYGON_RELAY_TX_TIMEOUT_MS", "120000"),
      10_000,
      900_000,
      120_000,
    );
    this.polygonRelayStuckSeconds = this.readInteger(
      config.get<string>("POLYGON_RELAY_STUCK_SECONDS", "180"),
      30,
      86_400,
      180,
    );
    this.polygonRelayMaxAttempts = this.readInteger(
      config.get<string>("POLYGON_RELAY_MAX_ATTEMPTS", "5"),
      1,
      20,
      5,
    );

    this.enabled = Boolean(
      this.rpcUrl &&
      this.hasSignerConfiguration() &&
      this.chainId !== null &&
      [this.factoryAddress, this.treasuryAddress, this.registryAddress, this.tokenAddress].every(
        (address) => ethers.isAddress(address) && address !== ethers.ZeroAddress,
      ),
    );

    if (!this.enabled) {
      this.logger.warn(
        "Blockchain disabled: signer or chain configuration is incomplete. The service runs in stub mode.",
      );
    }
  }

  private hasSignerConfiguration(): boolean {
    if (this.signerType === "web3signer") {
      return (
        this.isHttpUrl(this.web3SignerRpcUrl) &&
        ethers.isAddress(this.web3SignerAddress)
      );
    }
    return this.signerType === "local" && Boolean(this.privateKey);
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }

  private readRpcUrls(primary: string, configured: string): string[] {
    const values = [primary, ...configured.split(",")]
      .map((value) => value.trim())
      .filter((value) => this.isHttpUrl(value));
    return [...new Set(values)];
  }

  private readInteger(
    value: string,
    minimum: number,
    maximum: number,
    fallback: number,
  ): number {
    if (!/^\d+$/.test(value)) return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
      ? parsed
      : fallback;
  }
}
