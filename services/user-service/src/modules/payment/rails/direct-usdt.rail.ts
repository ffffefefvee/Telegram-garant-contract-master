import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Deal } from '../../deal/entities/deal.entity';
import { Currency } from '../../deal/enums/deal.enum';
import { EscrowService } from '../../escrow/escrow.service';
import { RelayService } from '../../blockchain/relay.service';
import { EscrowStatus } from '../../blockchain/blockchain.types';
import { Payment } from '../entities/payment.entity';
import { PaymentMethod } from '../enums/payment.enum';
import {
  PaymentRail,
  RailInvoice,
  RailInvoiceContext,
  RailStatusResult,
} from './payment-rail.types';

const USDT_DECIMALS = 6;

/**
 * Direct USDT (Polygon) rail.
 *
 * The buyer sends USDT from ANY wallet/exchange straight to the deal's
 * deterministic escrow clone address. No payment gateway, no custody:
 * funds land in the smart contract, and the relay only calls
 * `notifyFunded()` once the on-chain balance covers amount + buyerFee.
 *
 * Works from any country (incl. RU/BY where Cryptomus is unavailable).
 * Overpayments are recoverable via the contract's `rescue()` path.
 */
@Injectable()
export class DirectUsdtRail implements PaymentRail {
  readonly method = PaymentMethod.CRYPTO;
  readonly label = 'USDT (Polygon) — прямой перевод';

  private readonly logger = new Logger(DirectUsdtRail.name);

  constructor(
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    private readonly escrow: EscrowService,
    private readonly relay: RelayService,
  ) {}

  isAvailable(): boolean {
    return this.escrow.isEnabled();
  }

  async createInvoice(ctx: RailInvoiceContext): Promise<RailInvoice> {
    if (!this.isAvailable()) {
      throw new BadRequestException(
        'Direct USDT payments are unavailable: blockchain is not configured',
      );
    }

    const deal = await this.dealRepository.findOne({
      where: { id: ctx.dealId },
      relations: ['buyer', 'seller'],
    });
    if (!deal) {
      throw new BadRequestException(`Deal not found: ${ctx.dealId}`);
    }

    const buyerWallet = deal.buyer?.walletAddress ?? null;
    const sellerWallet = deal.seller?.walletAddress ?? null;
    if (!buyerWallet || !sellerWallet) {
      throw new BadRequestException(
        'Both buyer and seller must attach wallet addresses before a direct USDT payment',
      );
    }

    const amountUsdt = this.resolveUsdtAmount(deal, ctx.amount);

    // Deploy the clone now (if not yet) so the buyer has a real address to pay.
    let escrowAddress = deal.escrowAddress;
    if (!escrowAddress || escrowAddress === ethers.ZeroAddress) {
      const result = await this.escrow.createEscrow(
        deal.id,
        buyerWallet,
        sellerWallet,
        amountUsdt,
      );
      escrowAddress = result.escrowAddress;
      deal.escrowAddress = escrowAddress;
      if (deal.amountUsdt == null) {
        deal.amountUsdt = amountUsdt;
      }
      await this.dealRepository.save(deal);
      this.logger.log(
        `Escrow deployed for direct payment, deal=${deal.id} @ ${escrowAddress}`,
      );
    }

    const snapshot = await this.relay.readEscrow(escrowAddress);
    if (!snapshot) {
      throw new BadRequestException(
        `Escrow not readable on-chain for deal ${ctx.dealId}`,
      );
    }
    const requiredWei = snapshot.amount + snapshot.buyerFee;
    const requiredAmount = ethers.formatUnits(requiredWei, USDT_DECIMALS);
    const expiresAt = new Date(snapshot.fundingDeadline * 1000);

    return {
      depositAddress: escrowAddress,
      network: 'polygon',
      asset: 'USDT',
      requiredAmount,
      expiresAt,
      metadata: {
        rail: 'direct_usdt',
        requiredWei: requiredWei.toString(),
        fundingDeadline: snapshot.fundingDeadline,
      },
    };
  }

  /**
   * On-chain check: reads the clone state; if the balance covers
   * amount + buyerFee while still AWAITING_FUNDING, fires notifyFunded().
   * Idempotent — an already-FUNDED escrow simply reports completed.
   */
  async checkStatus(payment: Payment): Promise<RailStatusResult> {
    const escrowAddress = payment.escrowAddress;
    if (!escrowAddress || escrowAddress === ethers.ZeroAddress) {
      return { completed: false };
    }
    if (!this.isAvailable()) {
      return { completed: false };
    }

    const snapshot = await this.relay.readEscrow(escrowAddress);
    if (!snapshot) {
      return { completed: false };
    }

    const requiredWei = snapshot.amount + snapshot.buyerFee;
    const requiredUsdt = Number(ethers.formatUnits(requiredWei, USDT_DECIMALS));
    const receivedUsdt = Number(
      ethers.formatUnits(snapshot.balance, USDT_DECIMALS),
    );

    // Already funded (or later) — e.g. confirmed by a previous tick or restart.
    if (this.relay.isFundedOrLater(snapshot)) {
      return {
        completed: true,
        fundedUsdt: receivedUsdt > 0 ? receivedUsdt : requiredUsdt,
        requiredUsdt,
      };
    }

    if (snapshot.status !== EscrowStatus.AWAITING_FUNDING) {
      // CANCELLED/EXPIRED — cannot be paid anymore.
      return { completed: false, expired: true, receivedUsdt, requiredUsdt };
    }

    const deadlinePassed =
      Math.floor(Date.now() / 1000) > snapshot.fundingDeadline;

    if (snapshot.balance >= requiredWei && !deadlinePassed) {
      const txId = await this.relay.notifyFundedOnly(escrowAddress);
      return {
        completed: true,
        txId,
        fundedUsdt: receivedUsdt,
        requiredUsdt,
      };
    }

    if (deadlinePassed) {
      return { completed: false, expired: true, receivedUsdt, requiredUsdt };
    }

    return { completed: false, receivedUsdt, requiredUsdt };
  }

  /**
   * Direct rail settles in USDT only. Deals quoted in USDT use the deal
   * amount as-is; deals with a locked USDT equivalent use that.
   */
  private resolveUsdtAmount(deal: Deal, fallbackAmount: number): number {
    if (deal.amountUsdt != null && Number(deal.amountUsdt) > 0) {
      return Number(deal.amountUsdt);
    }
    if (deal.currency === Currency.USDT) {
      return Number(deal.amount) > 0 ? Number(deal.amount) : fallbackAmount;
    }
    throw new BadRequestException(
      'Direct USDT payment requires a USDT-denominated deal (or a locked USDT amount)',
    );
  }
}
