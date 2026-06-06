import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainProvider } from './blockchain.provider';
import { Erc20Client } from './erc20.client';
import { FactoryClient } from './factory.client';
import { EscrowClient } from './escrow.client';
import { CreateEscrowParams, EscrowSnapshot, EscrowStatus, FeeQuote } from './blockchain.types';

/**
 * Coordinates the platform hot-wallet operations: deploys escrow clones,
 * forwards USDT from the platform's hot-wallet (where Cryptomus pays) into
 * the freshly-deployed clone, and triggers `notifyFunded()` on-chain.
 *
 * This is the single thing that holds custody of buyer funds for at most
 * a few seconds between Cryptomus payment confirmation and forwarding.
 * Sellers' funds NEVER touch this wallet — they go directly from clone
 * to seller's wallet on `release()`.
 */
@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(
    private readonly provider: BlockchainProvider,
    private readonly erc20: Erc20Client,
    private readonly factory: FactoryClient,
    private readonly escrow: EscrowClient,
  ) {}

  /**
   * Returns the relay/admin wallet address (the address that Cryptomus
   * should send USDT to). Cryptomus invoices are configured to pay this
   * address; the relay then forwards into per-deal escrow clones.
   */
  hotWalletAddress(): string {
    return this.provider.signerAddress;
  }

  async hotWalletBalance(): Promise<bigint> {
    if (!this.provider.isReady) return 0n;
    return this.erc20.balanceOf(this.hotWalletAddress());
  }

  /**
   * Quote the on-chain fee for a deal of given amount + fee model.
   * Pure view — no tx, safe to call before deal creation.
   */
  async quote(amount: bigint, feeModel: number): Promise<FeeQuote> {
    return this.factory.quoteFee(amount, feeModel);
  }

  /**
   * Deploy a fresh escrow clone for a deal. Caller must be the relay (the
   * factory enforces RELAY_ROLE). Returns the deployed clone's address.
   */
  async deployEscrow(params: CreateEscrowParams): Promise<{ escrow: string; txHash: string }> {
    return this.factory.createEscrow(params);
  }

  /**
   * Forward `amount` USDT from the relay hot-wallet to `escrowAddress`,
   * then call `notifyFunded()` on the clone. Idempotent at the contract
   * level — calling notifyFunded twice on a FUNDED escrow reverts safely.
   *
   * Returns the two tx hashes.
   */
  async forwardAndFund(
    escrowAddress: string,
    amount: bigint,
  ): Promise<{ transferTxHash: string; notifyTxHash: string }> {
    if (!this.provider.isReady) {
      throw new Error('Blockchain not ready');
    }
    const balance = await this.erc20.balanceOf(this.hotWalletAddress());
    if (balance < amount) {
      throw new Error(
        `Hot-wallet balance ${balance} < required ${amount} (USDT short for forwarding to ${escrowAddress})`,
      );
    }
    this.logger.log(`Forwarding ${amount} USDT to escrow ${escrowAddress}…`);
    const transferTxHash = await this.erc20.transfer(escrowAddress, amount);
    const notifyTxHash = await this.escrow.notifyFunded(escrowAddress);
    this.logger.log(
      `Escrow ${escrowAddress} funded: transfer=${transferTxHash}, notify=${notifyTxHash}`,
    );
    return { transferTxHash, notifyTxHash };
  }

  /**
   * Get the canonical on-chain state of an escrow. Used by reconciliation
   * jobs to detect drift between DB and chain.
   */
  async readEscrow(address: string): Promise<EscrowSnapshot | null> {
    return this.escrow.snapshot(address);
  }

  /**
   * Convenience: assign an arbitrator to a disputed escrow. The address
   * must already be hired and `isEligible() == true` in the registry.
   */
  async assignArbitrator(escrowAddress: string, arbitrator: string): Promise<string> {
    return this.escrow.assignArbitrator(escrowAddress, arbitrator);
  }

  /**
   * Force-expire an unfunded deal past its deadline. Anyone can call;
   * useful for cleanup jobs.
   */
  async expireUnfunded(escrowAddress: string): Promise<string> {
    return this.escrow.expire(escrowAddress);
  }

  /**
   * Returns true when the escrow exists on-chain and is in any FUNDED-or-later status.
   */
  isFundedOrLater(snapshot: EscrowSnapshot): boolean {
    return [
      EscrowStatus.FUNDED,
      EscrowStatus.RELEASED,
      EscrowStatus.REFUNDED,
      EscrowStatus.DISPUTED,
      EscrowStatus.RESOLVED,
    ].includes(snapshot.status);
  }

  /**
   * Predicts the address of the clone for a dealId without deploying it.
   * Used pre-payment so backend knows where to forward USDT.
   */
  async predictAddress(dealId: string): Promise<string> {
    return this.factory.predictAddress(dealId);
  }

  /**
   * Convenience: bytes32-encode an arbitrary string dealId. Most callers
   * already have UUIDs — convert them to bytes32 here.
   */
  static toBytes32(dealId: string): string {
    if (ethers.isBytesLike(dealId) && ethers.dataLength(dealId) === 32) {
      return dealId;
    }
    return ethers.keccak256(ethers.toUtf8Bytes(dealId));
  }
}
