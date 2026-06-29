import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainConfig } from './blockchain.config';
import { BlockchainProvider } from './blockchain.provider';
import { RelayTxQueue } from './relay-tx-queue';
import erc20Abi from './abi/IERC20.json';

/**
 * Thin wrapper around an ERC-20 token (USDT in production).
 * All amounts are in native token wei (USDT has 6 decimals).
 */
@Injectable()
export class Erc20Client {
  private readonly logger = new Logger(Erc20Client.name);
  private _readonly: ethers.Contract | null = null;
  private _writable: ethers.Contract | null = null;

  constructor(
    private readonly cfg: BlockchainConfig,
    private readonly provider: BlockchainProvider,
    private readonly txQueue: RelayTxQueue,
  ) {}

  private read(): ethers.Contract {
    if (!this._readonly) {
      this._readonly = new ethers.Contract(this.cfg.tokenAddress, erc20Abi, this.provider.provider);
    }
    return this._readonly;
  }

  private write(): ethers.Contract {
    if (!this._writable) {
      this._writable = new ethers.Contract(this.cfg.tokenAddress, erc20Abi, this.provider.signer);
    }
    return this._writable;
  }

  async balanceOf(address: string): Promise<bigint> {
    if (!this.provider.isReady) return 0n;
    return (await this.read().balanceOf(address)) as bigint;
  }

  async decimals(): Promise<number> {
    if (!this.provider.isReady) return 6;
    return Number(await this.read().decimals());
  }

  /**
   * Transfer USDT from the signer's hot-wallet to `to`. Returns the tx hash.
   */
  async transfer(to: string, amount: bigint): Promise<string> {
    if (!this.provider.isReady) {
      throw new Error('Blockchain not ready');
    }
    // Serialized via RelayTxQueue: the relay signer is shared, so concurrent
    // broadcasts would collide on the same nonce.
    return this.txQueue.submit(`erc20.transfer ${amount}→${to}`, async () => {
      const tx = await this.write().transfer(to, amount);
      const receipt = await tx.wait();
      this.logger.log(`USDT transfer ${amount} → ${to}, tx=${receipt.hash}`);
      return receipt.hash as string;
    });
  }
}
