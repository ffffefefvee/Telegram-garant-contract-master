import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Deal } from '../../deal/entities/deal.entity';
import { EscrowService } from '../../escrow/escrow.service';
import { RelayService } from '../../blockchain/relay.service';
import { Payment } from '../entities/payment.entity';
import { PaymentMethod } from '../enums/payment.enum';
import { RailInvoice } from './payment-rail.types';
import { TonApiService, TON_DECIMALS } from './ton-api.service';
import {
  BaseTonRail,
  TonInvoiceBuildArgs,
  TonRailProgress,
} from './ton-rail.base';
import { TonFundingLockService } from './ton-funding-lock.service';

const USDT_DECIMALS = 6;
/** Required TON amounts are rounded UP to this many decimal places so the
 *  displayed amount and the deeplink amount cover the requirement exactly. */
const TON_DISPLAY_DECIMALS = 4;

/**
 * Native Toncoin rail.
 *
 * Toncoin is the easiest asset for RU buyers to obtain (@wallet P2P sells
 * it directly), but its price moves — unlike USDT-TON, accepting it needs
 * an exchange rate. The volatility is handled with a RATE LOCK:
 *
 *  - at invoice time the TON/USD rate is fetched (tonapi) and FROZEN in
 *    payment.metadata; the buyer sees a fixed TON amount
 *  - the required amount includes a small safety buffer
 *    (`TON_RATE_BUFFER_PCT`, default 1%) cushioning the float against the
 *    price moving between payment and a TON→Polygon rebalance
 *  - the lock expires after `TON_RATE_LOCK_TTL_MINUTES` (default 30): an
 *    unpaid invoice can then no longer complete (`expired`) — the buyer
 *    simply creates a new payment at the current rate. Without a TTL a
 *    buyer could hold a free price option against the platform.
 *
 * Settlement is identical to the USDT-TON rail (see `BaseTonRail`): memo
 * matching via tonapi → relay funds the Polygon escrow from its USDT float.
 * The received Toncoin sits on the platform TON wallet until rebalanced.
 */
@Injectable()
export class ToncoinRail extends BaseTonRail {
  readonly method = PaymentMethod.CRYPTO_TONCOIN;
  readonly label = 'TON (Toncoin) — через @wallet';

  protected readonly logger = new Logger(ToncoinRail.name);

  private readonly rateBufferPct: number;
  private readonly rateLockTtlMinutes: number;

  constructor(
    @InjectRepository(Deal)
    dealRepository: Repository<Deal>,
    escrow: EscrowService,
    relay: RelayService,
    tonApi: TonApiService,
    config: ConfigService,
    fundingLock: TonFundingLockService,
  ) {
    super(dealRepository, escrow, relay, tonApi, config, fundingLock);
    this.rateBufferPct = Number(
      config.get<string>('TON_RATE_BUFFER_PCT', '1'),
    );
    this.rateLockTtlMinutes = Number(
      config.get<string>('TON_RATE_LOCK_TTL_MINUTES', '30'),
    );
  }

  /** No rate — no rail: never quote Toncoin amounts on a stale guess. */
  protected async railAvailable(): Promise<boolean> {
    try {
      await this.tonApi.getTonUsdRate();
      return true;
    } catch (err) {
      this.logger.warn(`TON/USD rate unavailable: ${(err as Error).message}`);
      return false;
    }
  }

  protected async buildInvoice(args: TonInvoiceBuildArgs): Promise<RailInvoice> {
    const rate = await this.tonApi.getTonUsdRate();
    const requiredUsdt = Number(
      ethers.formatUnits(args.requiredWei, USDT_DECIMALS),
    );

    const requiredNanoton = this.quoteNanoton(args.requiredWei, rate);
    const requiredAmount = ethers.formatUnits(requiredNanoton, TON_DECIMALS);

    const rateLockExpiresAt = Math.min(
      args.fundingDeadline,
      Math.floor(Date.now() / 1000) + this.rateLockTtlMinutes * 60,
    );

    this.logger.log(
      `Toncoin invoice: ${requiredAmount} TON @ ${rate} USD ` +
        `(${requiredUsdt} USDT + ${this.rateBufferPct}% buffer), ` +
        `rate lock until ${new Date(rateLockExpiresAt * 1000).toISOString()}`,
    );

    return {
      depositAddress: this.tonApi.getWalletAddress(),
      escrowAddress: args.escrowAddress,
      network: 'ton',
      asset: 'TON',
      requiredAmount,
      memo: args.memo,
      expiresAt: new Date(rateLockExpiresAt * 1000),
      metadata: {
        rail: 'toncoin',
        memo: args.memo,
        requiredWei: args.requiredWei.toString(),
        fundingDeadline: args.fundingDeadline,
        lockedRate: rate,
        requiredNanoton: requiredNanoton.toString(),
        rateLockExpiresAt,
        usdtEquivalent: requiredUsdt,
      },
    };
  }

  protected async measureProgress(
    payment: Payment,
    memo: string,
    sinceUnix: number,
  ): Promise<TonRailProgress | null> {
    const requiredUnits = this.parseRequiredNanoton(payment);
    if (requiredUnits === null) {
      return null; // unusable metadata — base reports "no progress"
    }
    const incoming = await this.tonApi.findIncomingTonByMemo(memo, sinceUnix);
    return {
      requiredUnits,
      receivedUnits: incoming.receivedUnits,
      lastTxHash: incoming.lastTxHash,
    };
  }

  /** Display conversion at the LOCKED rate (what the buyer was quoted). */
  protected unitsToUsdt(payment: Payment, units: bigint): number {
    const rate = Number(payment.metadata?.lockedRate ?? 0);
    if (!isFinite(rate) || rate <= 0) return 0;
    const ton = Number(ethers.formatUnits(units, TON_DECIMALS));
    return Math.round(ton * rate * 100) / 100;
  }

  /** The rate lock caps the escrow deadline for this rail. */
  protected paymentDeadlineUnix(
    payment: Payment,
    fundingDeadline: number,
  ): number {
    const lockExpiry = Number(payment.metadata?.rateLockExpiresAt ?? 0);
    if (!Number.isFinite(lockExpiry) || lockExpiry <= 0) {
      return fundingDeadline;
    }
    return Math.min(fundingDeadline, lockExpiry);
  }

  /**
   * USDT → nanotons at `rate`, plus the safety buffer, rounded UP to
   * `TON_DISPLAY_DECIMALS` so the displayed amount covers the requirement.
   * Exact integer math — float rounding must never change a quote.
   */
  private quoteNanoton(requiredWei: bigint, rate: number): bigint {
    const rateMicro = BigInt(Math.round(rate * 1e6)); // USD per TON, 6 dp
    const bufferBp = BigInt(Math.round(this.rateBufferPct * 100)); // basis points
    // nanoton = requiredWei(6dp) / rate, ceil-rounded at 4 dp of TON:
    const numerator = requiredWei * 10n ** 9n * (10_000n + bufferBp);
    const denominator =
      rateMicro * 10_000n * 10n ** BigInt(TON_DECIMALS - TON_DISPLAY_DECIMALS);
    const displayUnits = (numerator + denominator - 1n) / denominator; // ceil
    return (
      displayUnits * 10n ** BigInt(TON_DECIMALS - TON_DISPLAY_DECIMALS)
    );
  }

  /** Locked required amount from metadata; null when missing/malformed. */
  private parseRequiredNanoton(payment: Payment): bigint | null {
    try {
      const raw = payment.metadata?.requiredNanoton as string | undefined;
      if (!raw) return null;
      const units = BigInt(raw);
      return units > 0n ? units : null;
    } catch {
      return null;
    }
  }
}
