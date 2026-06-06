import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainConfig } from './blockchain.config';
import { BlockchainProvider } from './blockchain.provider';
import treasuryAbi from './abi/PlatformTreasury.json';

/**
 * Read-only-mostly wrapper around PlatformTreasury. The platform multisig
 * owns ADMIN_ROLE and is the only entity that should call mutating methods
 * (`compensateUser`, `withdraw`, `setReserveBps`). The backend uses this
 * client primarily to:
 *  - read mainBalance / reserveBalance for admin dashboards
 *  - emit reconcile() periodically to capture untracked transfers
 */
@Injectable()
export class TreasuryClient {
  private readonly logger = new Logger(TreasuryClient.name);
  private _readonly: ethers.Contract | null = null;
  private _writable: ethers.Contract | null = null;

  constructor(
    private readonly cfg: BlockchainConfig,
    private readonly provider: BlockchainProvider,
  ) {}

  private read(): ethers.Contract {
    if (!this._readonly) {
      this._readonly = new ethers.Contract(this.cfg.treasuryAddress, treasuryAbi, this.provider.provider);
    }
    return this._readonly;
  }

  private write(): ethers.Contract {
    if (!this._writable) {
      this._writable = new ethers.Contract(this.cfg.treasuryAddress, treasuryAbi, this.provider.signer);
    }
    return this._writable;
  }

  async balances(): Promise<{ main: bigint; reserve: bigint }> {
    if (!this.provider.isReady) return { main: 0n, reserve: 0n };
    const [main, reserve] = await Promise.all([
      this.read().mainBalance() as Promise<bigint>,
      this.read().reserveBalance() as Promise<bigint>,
    ]);
    return { main, reserve };
  }

  async reserveBps(): Promise<number> {
    if (!this.provider.isReady) return 2000;
    return Number(await this.read().reserveBps());
  }

  /**
   * Captures untracked USDT transferred directly to the treasury into
   * mainBalance. Idempotent — reads token.balanceOf and reconciles deltas.
   * Safe to schedule on a cron.
   */
  async reconcile(): Promise<string | null> {
    if (!this.provider.isReady) return null;
    const tx = await this.write().reconcile();
    const receipt = await tx.wait();
    this.logger.log(`Treasury reconciled, tx=${receipt.hash}`);
    return receipt.hash as string;
  }
}
