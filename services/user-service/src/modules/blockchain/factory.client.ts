import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainConfig } from './blockchain.config';
import { BlockchainProvider } from './blockchain.provider';
import { CreateEscrowParams, FeeModel, FeeQuote } from './blockchain.types';
import factoryAbi from './abi/EscrowFactory.json';

@Injectable()
export class FactoryClient {
  private readonly logger = new Logger(FactoryClient.name);
  private _readonly: ethers.Contract | null = null;
  private _writable: ethers.Contract | null = null;

  constructor(
    private readonly cfg: BlockchainConfig,
    private readonly provider: BlockchainProvider,
  ) {}

  private read(): ethers.Contract {
    if (!this._readonly) {
      this._readonly = new ethers.Contract(this.cfg.factoryAddress, factoryAbi, this.provider.provider);
    }
    return this._readonly;
  }

  private write(): ethers.Contract {
    if (!this._writable) {
      this._writable = new ethers.Contract(this.cfg.factoryAddress, factoryAbi, this.provider.signer);
    }
    return this._writable;
  }

  /**
   * Computes the fee schedule (D5) and split (D4) for a deal. Pure view;
   * safe to call before creating an escrow.
   */
  async quoteFee(amount: bigint, feeModel: FeeModel): Promise<FeeQuote> {
    if (!this.provider.isReady) {
      // Stub mode: 5% flat, mirror contract logic for unit tests.
      const totalFee = (amount * 500n) / 10000n;
      const split = this.stubSplit(totalFee, feeModel);
      return {
        totalFee,
        buyerFee: split.buyerFee,
        sellerFee: split.sellerFee,
        buyerPayable: amount + split.buyerFee,
        sellerNet: amount - split.sellerFee,
      };
    }
    const totalFee = (await this.read().computeTotalFee(amount)) as bigint;
    const [buyerFee, sellerFee] = (await this.read().splitFee(totalFee, feeModel)) as [bigint, bigint];
    return {
      totalFee,
      buyerFee,
      sellerFee,
      buyerPayable: amount + buyerFee,
      sellerNet: amount - sellerFee,
    };
  }

  /**
   * Predicts the address of the clone deployed for a given dealId. Useful for
   * the relay to know where to forward USDT before `createEscrow` is on-chain.
   */
  async predictAddress(dealId: string): Promise<string> {
    if (!this.provider.isReady) return ethers.ZeroAddress;
    return (await this.read().predictEscrowAddress(dealId)) as string;
  }

  /**
   * Deploys a clone via Clones.cloneDeterministic(salt=dealId).
   * Caller must have `RELAY_ROLE` on the factory.
   */
  async createEscrow(params: CreateEscrowParams): Promise<{ escrow: string; txHash: string }> {
    if (!this.provider.isReady) {
      throw new Error('Blockchain not ready');
    }
    const tx = await this.write().createEscrow(
      params.dealId,
      params.buyer,
      params.seller,
      params.amount,
      params.feeModel,
      BigInt(params.fundingDeadline),
    );
    const receipt = await tx.wait();
    const escrow = (await this.read().escrowOf(params.dealId)) as string;
    this.logger.log(`Escrow deployed for dealId=${params.dealId} → ${escrow}, tx=${receipt.hash}`);
    return { escrow, txHash: receipt.hash as string };
  }

  /**
   * Looks up an existing clone for a dealId. Returns ZeroAddress if not deployed.
   */
  async escrowOf(dealId: string): Promise<string> {
    if (!this.provider.isReady) return ethers.ZeroAddress;
    return (await this.read().escrowOf(dealId)) as string;
  }

  private stubSplit(total: bigint, model: FeeModel): { buyerFee: bigint; sellerFee: bigint } {
    switch (model) {
      case FeeModel.SPLIT_50_50:
        return { buyerFee: total / 2n, sellerFee: total - total / 2n };
      case FeeModel.BUYER_100:
        return { buyerFee: total, sellerFee: 0n };
      case FeeModel.SELLER_100:
        return { buyerFee: 0n, sellerFee: total };
      default:
        return { buyerFee: total / 2n, sellerFee: total - total / 2n };
    }
  }
}
