import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainProvider } from './blockchain.provider';
import { Erc20Client } from './erc20.client';
import { FactoryClient } from './factory.client';
import { EscrowClient } from './escrow.client';
import { CreateEscrowParams, EscrowSnapshot, EscrowStatus, FeeQuote } from './blockchain.types';

/**
 * Outcome of {@link RelayService.forwardAndFund}. `transferTxHash` is null
 * when the clone already held enough USDT (a previous transfer landed but
 * notifyFunded failed); `notifyTxHash` is null when the escrow was already
 * FUNDED and nothing had to be done.
 */
export interface ForwardAndFundResult {
  transferTxHash: string | null;
  notifyTxHash: string | null;
  alreadyFunded: boolean;
}

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
  ): Promise<ForwardAndFundResult> {
    if (!this.provider.isReady) {
      throw new Error('Blockchain not ready');
    }

    // Recovery-aware funding. `transfer` and `notifyFunded` are two separate
    // txs: if the first lands but the second fails (gas spike, RPC blip), the
    // USDT is already in the clone. A naive retry would transfer a SECOND
    // time. So we inspect on-chain state first and only do the work that is
    // still missing, making the whole operation idempotent.
    const snapshot = await this.escrow.snapshot(escrowAddress);
    if (snapshot && this.isFundedOrLater(snapshot)) {
      this.logger.log(
        `Escrow ${escrowAddress} already funded (status=${snapshot.status}) — skipping forward (idempotent)`,
      );
      return { transferTxHash: null, notifyTxHash: null, alreadyFunded: true };
    }

    // The contract's funding check is `balance >= amount + buyerFee`. Prefer
    // the authoritative on-chain figure; fall back to the caller's amount if
    // the snapshot is unavailable.
    const required = snapshot ? snapshot.amount + snapshot.buyerFee : amount;
    const currentBalance = snapshot
      ? snapshot.balance
      : await this.erc20.balanceOf(escrowAddress);

    let transferTxHash: string | null = null;
    if (currentBalance < required) {
      const shortfall = required - currentBalance;
      const hotBalance = await this.erc20.balanceOf(this.hotWalletAddress());
      if (hotBalance < shortfall) {
        throw new Error(
          `Hot-wallet balance ${hotBalance} < required ${shortfall} (USDT short for forwarding to ${escrowAddress})`,
        );
      }
      this.logger.log(`Forwarding ${shortfall} USDT to escrow ${escrowAddress}…`);
      transferTxHash = await this.erc20.transfer(escrowAddress, shortfall);
    } else {
      // Transfer already landed on a previous attempt; only notify is left.
      this.logger.log(
        `Escrow ${escrowAddress} already holds ${currentBalance} ≥ ${required} USDT — skipping transfer, completing notifyFunded (recovery)`,
      );
    }

    const notifyTxHash = await this.escrow.notifyFunded(escrowAddress);
    this.logger.log(
      `Escrow ${escrowAddress} funded: transfer=${transferTxHash ?? 'skipped'}, notify=${notifyTxHash}`,
    );
    return { transferTxHash, notifyTxHash, alreadyFunded: false };
  }

  /**
   * Call `notifyFunded()` on a clone WITHOUT forwarding from the hot-wallet.
   * Used by the direct-deposit rail where the buyer transfers USDT straight
   * to the escrow clone address — the relay only confirms on-chain that the
   * balance covers amount + buyerFee. No custody is taken at any point.
   */
  async notifyFundedOnly(escrowAddress: string): Promise<string> {
    if (!this.provider.isReady) {
      throw new Error('Blockchain not ready');
    }
    const txHash = await this.escrow.notifyFunded(escrowAddress);
    this.logger.log(`Escrow ${escrowAddress} direct-funded: notify=${txHash}`);
    return txHash;
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
   * Extend the funding deadline of an AWAITING_FUNDING escrow (relay-only
   * on-chain). Admin recovery for late deposits: extend → the standard
   * matching/funding path completes instead of a manual refund.
   */
  async extendFundingDeadline(
    escrowAddress: string,
    newDeadlineUnix: number,
  ): Promise<string> {
    if (!this.provider.isReady) {
      throw new Error('Blockchain not ready');
    }
    return this.escrow.extendFundingDeadline(escrowAddress, newDeadlineUnix);
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
