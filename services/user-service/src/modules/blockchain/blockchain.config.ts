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
  readonly privateKey: string;
  readonly signerType: "local" | "web3signer" | null;
  readonly web3SignerRpcUrl: string;
  readonly web3SignerAddress: string;
  readonly chainId: number | null;

  readonly factoryAddress: string;
  readonly treasuryAddress: string;
  readonly registryAddress: string;
  readonly tokenAddress: string;

  constructor(config: ConfigService) {
    this.rpcUrl = config.get<string>("BLOCKCHAIN_RPC_URL", "");
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

    this.enabled = Boolean(
      this.rpcUrl &&
      this.hasSignerConfiguration() &&
      this.chainId !== null &&
      this.factoryAddress &&
      this.treasuryAddress &&
      this.registryAddress &&
      this.tokenAddress,
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
}
