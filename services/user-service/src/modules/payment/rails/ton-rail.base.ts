import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { TonApiService } from './ton-api.service';

const USDT_DECIMALS = 6;
const FLOAT_CACHE_TTL_MS = 60_000;

/** Everything a concrete rail needs to shape its invoice. */
export interface TonInvoiceBuildArgs {
  deal: Deal;
  escrowAddress: string;
  /** Required USDT on Polygon (deal amount + buyer fee), 6 dp units. */
  requiredWei: bigint;
  memo: string;
  /** Escrow funding deadline (unix seconds). */
  fundingDeadline: number;
}

/** Memo-matched progress of a payment, in the rail's native units. */
export interface TonRailProgress {
  /** Units the buyer must send in total (jetton units / nanotons). */
  requiredUnits: bigint;
  /** Units received so far via memo matching (excl. manual credits). */
  receivedUnits: bigint;
  /** Proof-of-payment reference of the latest matching transfer. */
  lastTxHash?: string;
}

/**
 * Shared core of the memo-based TON rails (USDT-TON and native Toncoin).
 *
 * The flow is identical for both: the buyer sends an asset on TON to the
 * platform wallet with the payment memo in the comment → a tonapi watcher
 * matches transfers by memo → the relay funds the deal's Polygon escrow
 * clone from its USDT float (`forwardAndFund`). The Polygon escrow remains
 * the single settlement layer — rails only differ in WHAT arrives on TON
 * and how it converts to the required USDT amount.
 *
 * Float policy (user decision, 2026-06-11): rails auto-hide from
 * `GET /payments/methods` when the relay float drops below
 * `TON_MIN_FLOAT_USDT`, and a specific invoice is refused when the float
 * cannot cover that deal's amount + buyer fee.
 *
 * Subclasses implement:
 *  - `buildInvoice`     — asset, required amount, rail-specific metadata
 *  - `measureProgress`  — memo matching + required units (or null when the
 *                         payment's metadata is unusable)
 *  - `unitsToUsdt`      — display conversion of native units
 *  - `paymentDeadlineUnix` (optional) — tighter deadline than the escrow's
 *                         (the Toncoin rail caps it with the rate lock TTL)
 */
export abstract class BaseTonRail implements PaymentRail {
  abstract readonly method: PaymentMethod;
  abstract readonly label: string;
  readonly kind = 'direct' as const;

  protected abstract readonly logger: Logger;
  protected readonly minFloatUsdt: number;

  private cachedFloat: bigint | null = null;
  private cachedFloatAt = 0;
  /** Per-escrow funding locks: protects the float from double-spends when
   *  the watcher tick and a user-triggered check race each other. */
  private readonly fundingLocks = new Set<string>();

  constructor(
    protected readonly dealRepository: Repository<Deal>,
    protected readonly escrow: EscrowService,
    protected readonly relay: RelayService,
    protected readonly tonApi: TonApiService,
    protected readonly config: ConfigService,
  ) {
    this.minFloatUsdt = Number(config.get<string>('TON_MIN_FLOAT_USDT', '500'));
  }

  protected abstract buildInvoice(
    args: TonInvoiceBuildArgs,
  ): Promise<RailInvoice>;

  protected abstract measureProgress(
    payment: Payment,
    memo: string,
    sinceUnix: number,
    requiredWei: bigint,
  ): Promise<TonRailProgress | null>;

  protected abstract unitsToUsdt(payment: Payment, units: bigint): number;

  /** Extra availability requirement (e.g. a fetchable exchange rate). */
  protected async railAvailable(): Promise<boolean> {
    return true;
  }

  /** Rails may shorten the escrow deadline (e.g. rate-lock TTL). */
  protected paymentDeadlineUnix(
    _payment: Payment,
    fundingDeadline: number,
  ): number {
    return fundingDeadline;
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
      if (float < minFloatWei) return false;
      return await this.railAvailable();
    } catch (err) {
      this.logger.warn(`Availability check failed: ${(err as Error).message}`);
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

    return this.buildInvoice({
      deal,
      escrowAddress,
      requiredWei,
      memo: this.generateMemo(),
      fundingDeadline: snapshot.fundingDeadline,
    });
  }

  /**
   * Watcher/user-triggered check: looks for incoming transfers with the
   * payment memo. Once the full amount has arrived, funds the Polygon
   * escrow from the relay float (idempotent: an already-FUNDED escrow
   * simply reports completed; a per-escrow lock prevents double-forwarding
   * when checks race).
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
      Math.floor(Date.now() / 1000) >
      this.paymentDeadlineUnix(payment, snapshot.fundingDeadline);

    const sinceUnix =
      Math.floor(new Date(payment.createdAt).getTime() / 1000) - 300;
    const progress = await this.measureProgress(
      payment,
      memo,
      sinceUnix,
      requiredWei,
    );
    if (!progress) {
      // Unusable payment metadata — never guess amounts with user money.
      this.logger.error(
        `Cannot measure progress of payment ${payment.id}: bad metadata`,
      );
      return { completed: false, requiredUsdt };
    }

    // Units an admin manually credited from the unmatched-deposit ledger
    // (buyer forgot/mistyped the memo) — counted exactly like memo matches.
    const manualUnits = this.parseManualCreditUnits(payment);
    const totalUnits = progress.receivedUnits + manualUnits;
    const receivedUsdt = this.unitsToUsdt(payment, totalUnits);

    if (totalUnits >= progress.requiredUnits && !deadlinePassed) {
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
          `TON payment ${payment.id} settled: ton_tx=${progress.lastTxHash} polygon_tx=${notifyTxHash}`,
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

  /** TON rails settle in USDT only (beta decision: USDT-only deals). */
  protected resolveUsdtAmount(deal: Deal, fallbackAmount: number): number {
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

  /** Admin-credited units from metadata; malformed values count as 0. */
  protected parseManualCreditUnits(payment: Payment): bigint {
    try {
      const units = BigInt(
        (payment.metadata?.manualCreditUnits as string) ?? '0',
      );
      return units >= 0n ? units : 0n;
    } catch {
      return 0n;
    }
  }

  /** Short, unambiguous transfer comment, e.g. "TG-7K2M9QX4". */
  protected generateMemo(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
    const bytes = randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }
    return `TG-${code}`;
  }

  protected async getFloat(force = false): Promise<bigint> {
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
