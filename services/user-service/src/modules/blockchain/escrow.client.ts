import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainProvider } from './blockchain.provider';
import { EscrowSnapshot, EscrowStatus, ResolveParams } from './blockchain.types';
import escrowAbi from './abi/EscrowImplementation.json';

/**
 * Wrapper around an EscrowImplementation clone. Created on demand per
 * escrow address (cheap; ethers.Contract is just an interface). The signer
 * is always the platform relay/admin wallet — buyer/seller actions
 * (release/refund/cancel/dispute) MUST be signed by users on the client side
 * (mini-app). The relay only signs:
 *  - notifyFunded() after Cryptomus payment
 *  - assignArbitrator() after off-chain selection
 *
 * This client centralises the ABI + retry logic but does NOT enforce who is
 * authorised to call each method — the contract does that on-chain.
 */
@Injectable()
export class EscrowClient {
  private readonly logger = new Logger(EscrowClient.name);

  constructor(private readonly provider: BlockchainProvider) {}

  private readContract(address: string): ethers.Contract {
    return new ethers.Contract(address, escrowAbi, this.provider.provider);
  }

  private writeContract(address: string): ethers.Contract {
    return new ethers.Contract(address, escrowAbi, this.provider.signer);
  }

  async snapshot(address: string): Promise<EscrowSnapshot | null> {
    if (!this.provider.isReady || address === ethers.ZeroAddress) {
      return null;
    }
    const c = this.readContract(address);
    const [
      status,
      buyer,
      seller,
      amount,
      buyerFee,
      sellerFee,
      fundingDeadline,
      assignedArbitrator,
      balance,
    ] = await Promise.all([
      c.status() as Promise<bigint>,
      c.buyer() as Promise<string>,
      c.seller() as Promise<string>,
      c.amount() as Promise<bigint>,
      c.buyerFee() as Promise<bigint>,
      c.sellerFee() as Promise<bigint>,
      c.fundingDeadline() as Promise<bigint>,
      c.assignedArbitrator() as Promise<string>,
      c.getBalance() as Promise<bigint>,
    ]);
    return {
      address,
      status: Number(status) as EscrowStatus,
      buyer,
      seller,
      amount,
      buyerFee,
      sellerFee,
      fundingDeadline: Number(fundingDeadline),
      assignedArbitrator,
      balance,
    };
  }

  async notifyFunded(address: string): Promise<string> {
    const c = this.writeContract(address);
    const tx = await c.notifyFunded();
    const receipt = await tx.wait();
    this.logger.log(`notifyFunded ${address}, tx=${receipt.hash}`);
    return receipt.hash as string;
  }

  async assignArbitrator(address: string, arbitrator: string): Promise<string> {
    const c = this.writeContract(address);
    const tx = await c.assignArbitrator(arbitrator);
    const receipt = await tx.wait();
    this.logger.log(`assignArbitrator ${address} → ${arbitrator}, tx=${receipt.hash}`);
    return receipt.hash as string;
  }

  /**
   * Convenience for arbitrator-side resolve. Caller must pass a Wallet that
   * matches the assigned arbitrator on-chain.
   */
  async resolveAs(
    address: string,
    arbitratorWallet: ethers.Wallet,
    params: ResolveParams,
  ): Promise<string> {
    const c = new ethers.Contract(address, escrowAbi, arbitratorWallet);
    const tx = await c.resolve(params.buyerSharePct, params.sellerSharePct);
    const receipt = await tx.wait();
    this.logger.log(
      `resolve ${address} ${params.buyerSharePct}/${params.sellerSharePct}, tx=${receipt.hash}`,
    );
    return receipt.hash as string;
  }

  /**
   * Force-expire an unfunded deal past its deadline. Anyone can call.
   */
  async expire(address: string): Promise<string> {
    const c = this.writeContract(address);
    const tx = await c.expire();
    const receipt = await tx.wait();
    this.logger.log(`expire ${address}, tx=${receipt.hash}`);
    return receipt.hash as string;
  }
}
