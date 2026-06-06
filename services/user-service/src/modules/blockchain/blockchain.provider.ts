import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainConfig } from './blockchain.config';

/**
 * Singleton holder for the JSON-RPC provider and the platform hot-wallet signer.
 * Returns null when blockchain is disabled (dev / test without an RPC).
 *
 * The signer here is the relay/admin wallet — it forwards USDT to escrow clones
 * and calls deal-initiating txs. Per-arbitrator txs (depositStake, etc.) are
 * signed by users on the client side; this signer never holds arbitrator stake.
 */
@Injectable()
export class BlockchainProvider implements OnModuleInit {
  private readonly logger = new Logger(BlockchainProvider.name);
  private _provider: ethers.JsonRpcProvider | null = null;
  private _signer: ethers.Wallet | null = null;

  constructor(private readonly cfg: BlockchainConfig) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.enabled) {
      return;
    }
    try {
      this._provider = new ethers.JsonRpcProvider(this.cfg.rpcUrl);
      this._signer = new ethers.Wallet(this.cfg.privateKey, this._provider);
      const network = await this._provider.getNetwork();
      this.logger.log(
        `BlockchainProvider connected: chainId=${network.chainId}, signer=${this._signer.address}`,
      );
    } catch (err) {
      this.logger.error('Failed to initialise blockchain provider', err as Error);
      this._provider = null;
      this._signer = null;
    }
  }

  get isReady(): boolean {
    return this._provider !== null && this._signer !== null;
  }

  /**
   * Read-only provider. Throws if blockchain is disabled — callers should
   * guard with `isReady` first when they want to fall back gracefully.
   */
  get provider(): ethers.JsonRpcProvider {
    if (!this._provider) {
      throw new Error('BlockchainProvider not initialised (blockchain disabled)');
    }
    return this._provider;
  }

  get signer(): ethers.Wallet {
    if (!this._signer) {
      throw new Error('BlockchainProvider signer not initialised (blockchain disabled)');
    }
    return this._signer;
  }

  /// Signer wallet address (the relay hot-wallet).
  get signerAddress(): string {
    return this._signer?.address ?? ethers.ZeroAddress;
  }

  /// Override the signer/provider in tests.
  _setForTesting(provider: ethers.JsonRpcProvider, signer: ethers.Wallet): void {
    this._provider = provider;
    this._signer = signer;
  }
}
