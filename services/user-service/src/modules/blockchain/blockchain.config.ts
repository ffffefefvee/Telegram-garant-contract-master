import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  readonly chainId: number | null;

  readonly factoryAddress: string;
  readonly treasuryAddress: string;
  readonly registryAddress: string;
  readonly tokenAddress: string;

  constructor(config: ConfigService) {
    this.rpcUrl = config.get<string>('BLOCKCHAIN_RPC_URL', '');
    this.privateKey = config.get<string>('BLOCKCHAIN_PRIVATE_KEY', '');
    this.factoryAddress = config.get<string>('ESCROW_FACTORY_ADDRESS', '');
    this.treasuryAddress = config.get<string>('PLATFORM_TREASURY_ADDRESS', '');
    this.registryAddress = config.get<string>('ARBITRATOR_REGISTRY_ADDRESS', '');
    this.tokenAddress = config.get<string>('USDT_CONTRACT_ADDRESS', '');
    const chainIdRaw = config.get<string>('BLOCKCHAIN_CHAIN_ID', '');
    this.chainId = chainIdRaw ? Number.parseInt(chainIdRaw, 10) : null;

    this.enabled = Boolean(
      this.rpcUrl &&
        this.privateKey &&
        this.factoryAddress &&
        this.treasuryAddress &&
        this.registryAddress &&
        this.tokenAddress,
    );

    if (!this.enabled) {
      this.logger.warn(
        'Blockchain disabled: one or more env vars missing. The service runs in stub mode.',
      );
    }
  }
}
