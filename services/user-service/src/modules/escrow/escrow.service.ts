import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainProvider } from '../blockchain/blockchain.provider';
import { FactoryClient } from '../blockchain/factory.client';
import { EscrowClient } from '../blockchain/escrow.client';
import { RelayService } from '../blockchain/relay.service';
import {
  EscrowStatus,
  FeeModel,
  FeeQuote,
} from '../blockchain/blockchain.types';

export interface EscrowCreationResult {
  dealId: string;
  escrowAddress: string;
  transactionHash: string;
  buyerFee: bigint;
  sellerFee: bigint;
}

export interface EscrowSummary {
  address: string;
  status: 'awaiting_funding' | 'funded' | 'released' | 'refunded' | 'disputed' | 'resolved' | 'cancelled' | 'expired' | 'unknown';
  buyer: string;
  seller: string;
  amount: bigint;
  buyerFee: bigint;
  sellerFee: bigint;
  fundingDeadline: number;
  assignedArbitrator: string;
  balance: bigint;
}

const STATUS_LABELS: Record<EscrowStatus, EscrowSummary['status']> = {
  [EscrowStatus.NONE]: 'unknown',
  [EscrowStatus.AWAITING_FUNDING]: 'awaiting_funding',
  [EscrowStatus.FUNDED]: 'funded',
  [EscrowStatus.RELEASED]: 'released',
  [EscrowStatus.REFUNDED]: 'refunded',
  [EscrowStatus.DISPUTED]: 'disputed',
  [EscrowStatus.RESOLVED]: 'resolved',
  [EscrowStatus.CANCELLED]: 'cancelled',
  [EscrowStatus.EXPIRED]: 'expired',
};

/**
 * Domain-level facade over the BlockchainModule. Translates between
 * deal-IDs (UUIDs) and on-chain bytes32 salts, parses USDT amounts (6
 * decimals), validates EVM addresses, and exposes a clean API to
 * `DealService` and `ArbitrationService`.
 *
 * No ethers types leak out of this service to its callers — they get
 * plain strings, bigints, and union-typed status labels.
 *
 * In stub mode (BLOCKCHAIN_* env vars missing), all methods return
 * deterministic placeholder values so dev environments without an RPC
 * still work end-to-end (deals get created, just without on-chain side).
 */
@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);
  private readonly DEFAULT_FUNDING_HOURS = 24;

  constructor(
    private readonly providerService: BlockchainProvider,
    private readonly factory: FactoryClient,
    private readonly escrowClient: EscrowClient,
    private readonly relay: RelayService,
  ) {}

  isEnabled(): boolean {
    return this.providerService.isReady;
  }

  /**
   * Quote the fee schedule for a deal. Pure view — no tx, safe to call from
   * UI flows before the user confirms.
   */
  async quote(amountUsdt: number, feeModel: FeeModel = FeeModel.SPLIT_50_50): Promise<FeeQuote> {
    const amount = this.toWei(amountUsdt);
    return this.factory.quoteFee(amount, feeModel);
  }

  /**
   * Predict the deterministic clone address for a dealId without deploying.
   * Used by Cryptomus webhook flow to know where to route incoming USDT.
   */
  async predictAddress(dealId: string): Promise<string> {
    const salt = RelayService.toBytes32(dealId);
    return this.factory.predictAddress(salt);
  }

  /**
   * Deploy the escrow clone for a deal. Caller must ensure both buyer and
   * seller have valid EVM wallets attached. Returns the deployed clone
   * address + transaction hash + computed fees.
   *
   * Defaults: feeModel=SPLIT_50_50, fundingDeadline=now+24h.
   */
  async createEscrow(
    dealId: string,
    buyerWallet: string,
    sellerWallet: string,
    amountUsdt: number,
    feeModel: FeeModel = FeeModel.SPLIT_50_50,
    fundingDeadlineSec?: number,
  ): Promise<EscrowCreationResult> {
    this.assertEvmAddress(buyerWallet, 'buyerWallet');
    this.assertEvmAddress(sellerWallet, 'sellerWallet');
    if (amountUsdt <= 0) {
      throw new BadRequestException('amount must be positive');
    }
    const amount = this.toWei(amountUsdt);
    const salt = RelayService.toBytes32(dealId);
    const deadline =
      fundingDeadlineSec ??
      Math.floor(Date.now() / 1000) + this.DEFAULT_FUNDING_HOURS * 3600;

    if (!this.providerService.isReady) {
      const placeholder = ethers.getAddress(
        '0x' + ethers.keccak256(ethers.toUtf8Bytes(dealId)).slice(26),
      );
      this.logger.warn(
        `[stub] createEscrow dealId=${dealId} → ${placeholder} (blockchain disabled)`,
      );
      const quote = await this.factory.quoteFee(amount, feeModel);
      return {
        dealId,
        escrowAddress: placeholder,
        transactionHash: '0x' + '0'.repeat(64),
        buyerFee: quote.buyerFee,
        sellerFee: quote.sellerFee,
      };
    }

    const result = await this.relay.deployEscrow({
      dealId: salt,
      buyer: buyerWallet,
      seller: sellerWallet,
      amount,
      feeModel,
      fundingDeadline: deadline,
    });
    const quote = await this.factory.quoteFee(amount, feeModel);
    return {
      dealId,
      escrowAddress: result.escrow,
      transactionHash: result.txHash,
      buyerFee: quote.buyerFee,
      sellerFee: quote.sellerFee,
    };
  }

  /**
   * Look up the deployed clone for a dealId. Returns ZeroAddress if not yet deployed.
   */
  async getEscrowAddress(dealId: string): Promise<string> {
    const salt = RelayService.toBytes32(dealId);
    return this.factory.escrowOf(salt);
  }

  /**
   * Forward USDT from the relay hot-wallet into a freshly-funded escrow,
   * then call notifyFunded() on the clone. Called by the Cryptomus webhook
   * after a payment is confirmed.
   */
  async forwardAndFund(
    dealId: string,
    amountUsdt: number,
  ): Promise<{ transferTxHash: string; notifyTxHash: string }> {
    const escrowAddress = await this.getEscrowAddress(dealId);
    if (!escrowAddress || escrowAddress === ethers.ZeroAddress) {
      throw new BadRequestException(`Escrow not deployed for deal ${dealId}`);
    }
    const amount = this.toWei(amountUsdt);
    return this.relay.forwardAndFund(escrowAddress, amount);
  }

  /**
   * Read on-chain state of an escrow. Used by reconciliation and admin views.
   * Returns null if the escrow doesn't exist on-chain or in stub mode.
   */
  async getSummary(dealId: string): Promise<EscrowSummary | null> {
    const escrowAddress = await this.getEscrowAddress(dealId);
    if (!escrowAddress || escrowAddress === ethers.ZeroAddress) {
      return null;
    }
    const snap = await this.escrowClient.snapshot(escrowAddress);
    if (!snap) return null;
    return {
      address: snap.address,
      status: STATUS_LABELS[snap.status] ?? 'unknown',
      buyer: snap.buyer,
      seller: snap.seller,
      amount: snap.amount,
      buyerFee: snap.buyerFee,
      sellerFee: snap.sellerFee,
      fundingDeadline: snap.fundingDeadline,
      assignedArbitrator: snap.assignedArbitrator,
      balance: snap.balance,
    };
  }

  /**
   * Force-expire an unfunded escrow past its deadline. Anyone can call;
   * we expose it here for cleanup jobs.
   */
  async expireUnfunded(dealId: string): Promise<string> {
    const escrowAddress = await this.getEscrowAddress(dealId);
    if (!escrowAddress || escrowAddress === ethers.ZeroAddress) {
      throw new BadRequestException(`Escrow not deployed for deal ${dealId}`);
    }
    return this.relay.expireUnfunded(escrowAddress);
  }

  /**
   * Assign an arbitrator to a disputed escrow. Caller must verify the
   * arbitrator is eligible (registry.isEligible) BEFORE calling.
   */
  async assignArbitrator(dealId: string, arbitratorWallet: string): Promise<string> {
    this.assertEvmAddress(arbitratorWallet, 'arbitratorWallet');
    const escrowAddress = await this.getEscrowAddress(dealId);
    if (!escrowAddress || escrowAddress === ethers.ZeroAddress) {
      throw new BadRequestException(`Escrow not deployed for deal ${dealId}`);
    }
    return this.relay.assignArbitrator(escrowAddress, arbitratorWallet);
  }

  /**
   * Convert USDT amount (6 decimals) to on-chain wei.
   * @internal — exposed for tests and DealService.
   */
  toWei(amountUsdt: number): bigint {
    if (!Number.isFinite(amountUsdt) || amountUsdt < 0) {
      throw new BadRequestException(`Invalid USDT amount: ${amountUsdt}`);
    }
    return ethers.parseUnits(amountUsdt.toFixed(6), 6);
  }

  /**
   * Validate an EVM address, throwing a 400 with a descriptive message.
   * Accepts any case; canonical (checksummed) format is not enforced here.
   */
  private assertEvmAddress(address: string, fieldName: string): void {
    if (!ethers.isAddress(address)) {
      throw new BadRequestException(
        `${fieldName} is not a valid EVM address: "${address}"`,
      );
    }
    if (address === ethers.ZeroAddress) {
      throw new BadRequestException(`${fieldName} cannot be the zero address`);
    }
  }
}
