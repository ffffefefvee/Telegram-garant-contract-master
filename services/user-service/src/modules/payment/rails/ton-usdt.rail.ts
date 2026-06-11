import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
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
import { TonApiService, TON_USDT_DECIMALS } from './ton-api.service';

const USDT_DECIMALS = 6;
const FLOAT_CACHE_TTL_MS = 60_000;

/**
 * USDT-TON rail (Stage 2).
 *
 * The buyer sends USDT in the TON network (from @wallet inside Telegram or
 * any TON wallet — works in RU/BY) to the platform's TON wallet with the
 * payment memo in the transfer comment. A tonapi watcher detects the
 * transfer; the relay then funds the deal's Polygon escrow clone from its
 * USDT float (`forwardAndFund`). The Polygon escrow remains the single
 * settlement layer — TON is only how money arrives.
 *
 * Float policy (user decision, 2026-06-11): the rail auto-hides from
 * `GET /payments/methods` when the relay float drops below
 * `TON_MIN_FLOAT_USDT`, and a specific invoice is refused when the float
 * cannot cover that deal's amount + buyer fee.
 */
@Injectable()
export class TonUsdtRail implements PaymentRail {
  readonly method = PaymentMethod.CRYPTO_TON;
  readonly label = 'USDT (TON) — через @wallet';
  readonly kind = 'direct' as const;

  private readonly logger = new Logger(TonUsdtRail.name);
  private readonly minFloatUsdt: number;

  private cachedFloat: bigint | null = null;
  private cachedFloatAt = 0;
  /** Per-escrow funding locks: protects the float from double-spends when
   *  the watcher tick and a user-triggered check race each other. */
  private readonly fundingLocks = new Set<string>();

  constructor(
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    private readonly escrow: EscrowService,
    private readonly relay: RelayService,
    private readonly tonApi: TonApiService,
    config: ConfigService,
  ) {
    this.minFloatUsdt = Number(config.get<string>('TON_MIN_FLOAT_USDT', '500'));
  }

  /**
   * Available when both sides are configured (TON wallet + Polygon escrow)
   * AND the relay float covers the minimum reserve. Async — the registry
   * awaits it; the float reading is cached for 60s.
   */
  async isAvailable(): Promise<boolean> {
    if (!this.tonApi.isEnabled() || !this.escrow.isEnabled()) return false;
    try {
      const float = await this.getFloat();
      const minFloatWei = ethers.parseUnits(
        String(this.minFloatUsdt),
        USDT_DECIMALS,
      );
      return float >= minFloatWei;
    } catch (err) {
      this.logger.warn(`Float check failed: ${(err as Error).message}`);
      return false;
    }
  }

  async createInvoice(ctx: RailInvoiceContext): Promise<RailInvoice> {
    if (!this.tonApi.isEnabled() || !this.escrow.isEnabled()) {
      throw new BadRequestException(
        'TON payments are unavailable: TON wallet or blockchain not configured',
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
        'Both buyer and seller must attach wallet addresses before a TON payment',
      );
    }

    const amountUsdt = this.resolveUsdtAmount(deal, ctx.amount);

    // Deploy the Polygon escrow clone now (if not yet) — the settlement
    // target must exist before we accept TON money against it.
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
        `Escrow deployed for TON payment, deal=${deal.id} @ ${escrowAddress}`,
      );
    }

    const snapshot = await this.relay.readEscrow(escrowAddress);
    if (!snapshot) {
      throw new BadRequestException(
        `Escrow not readable on-chain for deal ${ctx.dealId}`,
      );
    }
    const requiredWei = snapshot.amount + snapshot.buyerFee;

    // The relay must be able to fund this specific deal from its float.
    const float = await this.getFloat(true);
    if (float < requiredWei) {
      throw new BadRequestException(
        'TON payments are temporarily unavailable for this amount — please use another payment method',
      );
    }

    const requiredAmount = ethers.formatUnits(requiredWei, USDT_DECIMALS);
    const expiresAt = new Date(snapshot.fundingDeadline * 1000);
    const memo = this.generateMemo();

    return {
      depositAddress: this.tonApi.getWalletAddress(),
      escrowAddress,
      network: 'ton',
      asset: 'USDT',
      requiredAmount,
      memo,
      expiresAt,
      metadata: {
        rail: 'ton_usdt',
        memo,
        requiredWei: requiredWei.toString(),
        fundingDeadline: snapshot.fundingDeadline,
        jettonMaster: this.tonApi.getJettonMaster(),
      },
    };
  }

  /**
   * Watcher/user-triggered check: looks for incoming USDT-TON transfers
   * with the payment memo. Once the full amount has arrived, funds the
   * Polygon escrow from the relay float (idempotent: an already-FUNDED
   * escrow simply reports completed; a per-escrow lock prevents
   * double-forwarding when checks race).
   */
  async checkStatus(payment: Payment): Promise<RailStatusResult> {
    const escrowAddress = payment.escrowAddress;
    const memo = (payment.metadata?.memo as string) ?? null;
    if (!escrowAddress || escrowAddress === ethers.ZeroAddress || !memo) {
      return { completed: false };
    }
    if (!this.tonApi.isEnabled() || !this.escrow.isEnabled()) {
      return { completed: false };
    }

    const snapshot = await this.relay.readEscrow(escrowAddress);
    if (!snapshot) {
      return { completed: false };
    }

    const requiredWei = snapshot.amount + snapshot.buyerFee;
    const requiredUsdt = Number(ethers.formatUnits(requiredWei, USDT_DECIMALS));

    // Already funded (a previous tick / restart) — settle idempotently.
    if (this.relay.isFundedOrLater(snapshot)) {
      return {
        completed: true,
        txId: (payment.metadata?.tonTxHash as string) ?? undefined,
        fundedUsdt: requiredUsdt,
        requiredUsdt,
      };
    }

    if (snapshot.status !== EscrowStatus.AWAITING_FUNDING) {
      return { completed: false, expired: true, requiredUsdt };
    }

    const deadlinePassed =
      Math.floor(Date.now() / 1000) > snapshot.fundingDeadline;

    const sinceUnix =
      Math.floor(new Date(payment.createdAt).getTime() / 1000) - 300;
    const incoming = await this.tonApi.findIncomingUsdtByMemo(memo, sinceUnix);
    const receivedUsdt = Number(
      ethers.formatUnits(incoming.receivedUnits, TON_USDT_DECIMALS),
    );
    const requiredUnits = ethers.parseUnits(
      ethers.formatUnits(requiredWei, USDT_DECIMALS),
      TON_USDT_DECIMALS,
    );

    if (incoming.receivedUnits >= requiredUnits && !deadlinePassed) {
      if (this.fundingLocks.has(escrowAddress)) {
        // Another check is already forwarding — report progress only.
        return { completed: false, receivedUsdt, requiredUsdt };
      }
      this.fundingLocks.add(escrowAddress);
      try {
        const { notifyTxHash } = await this.relay.forwardAndFund(
          escrowAddress,
          requiredWei,
        );
        this.cachedFloat = null; // float changed — drop the cache
        this.logger.log(
          `TON payment ${payment.id} settled: ton_tx=${incoming.lastTxHash} polygon_tx=${notifyTxHash}`,
        );
        return {
          completed: true,
          txId: notifyTxHash,
          fundedUsdt: receivedUsdt,
          requiredUsdt,
        };
      } catch (err) {
        // Typical case: float momentarily short. Watcher retries every minute.
        this.logger.error(
          `TON received but escrow funding failed for payment ${payment.id}: ${(err as Error).message}`,
        );
        return { completed: false, receivedUsdt, requiredUsdt };
      } finally {
        this.fundingLocks.delete(escrowAddress);
      }
    }

    if (deadlinePassed) {
      return { completed: false, expired: true, receivedUsdt, requiredUsdt };
    }

    return { completed: false, receivedUsdt, requiredUsdt };
  }

  /** TON rail settles in USDT only (beta decision: USDT-only). */
  private resolveUsdtAmount(deal: Deal, fallbackAmount: number): number {
    if (deal.amountUsdt != null && Number(deal.amountUsdt) > 0) {
      return Number(deal.amountUsdt);
    }
    if (deal.currency === Currency.USDT) {
      return Number(deal.amount) > 0 ? Number(deal.amount) : fallbackAmount;
    }
    throw new BadRequestException(
      'TON payment requires a USDT-denominated deal (or a locked USDT amount)',
    );
  }

  /** Short, unambiguous transfer comment, e.g. "TG-7K2M9QX4". */
  private generateMemo(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
    const bytes = randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }
    return `TG-${code}`;
  }

  private async getFloat(force = false): Promise<bigint> {
    const now = Date.now();
    if (
      !force &&
      this.cachedFloat !== null &&
      now - this.cachedFloatAt < FLOAT_CACHE_TTL_MS
    ) {
      return this.cachedFloat;
    }
    const balance = await this.relay.hotWalletBalance();
    this.cachedFloat = balance;
    this.cachedFloatAt = now;
    return balance;
  }
}
