import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentMethod, PaymentStatus } from './enums/payment.enum';
import { RelayService } from '../blockchain/relay.service';
import { EscrowStatus } from '../blockchain/blockchain.types';

/** Direct rails whose funding window is the escrow's on-chain deadline. */
const DIRECT_CRYPTO_METHODS: ReadonlySet<PaymentMethod> = new Set([
  PaymentMethod.CRYPTO,
  PaymentMethod.CRYPTO_TON,
  PaymentMethod.CRYPTO_TONCOIN,
]);

/** Payment states an extension can act on. EXPIRED is revived to PENDING. */
const EXTENDABLE_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.EXPIRED,
]);

export const MAX_EXTENSION_HOURS = 168; // 7 days

export interface ExtendDeadlineResult {
  payment: Payment;
  escrowAddress: string;
  previousDeadlineUnix: number;
  newDeadlineUnix: number;
  txHash: string;
  rateLockExtended: boolean;
}

/**
 * Admin recovery: extend the on-chain funding deadline of a deal's escrow
 * so a LATE deposit can settle through the standard path (memo match or
 * manual unmatched-ledger match → forwardAndFund) instead of a manual refund.
 *
 * Only possible while the escrow clone is still AWAITING_FUNDING on-chain —
 * once it is EXPIRED/CANCELLED the buyer may already rescue() their funds,
 * and we never change that retroactively.
 */
@Injectable()
export class EscrowDeadlineService {
  private readonly logger = new Logger(EscrowDeadlineService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly relay: RelayService,
  ) {}

  async extend(
    paymentId: string,
    hours: number,
    adminId: string,
    options?: { extendRateLock?: boolean; note?: string },
  ): Promise<ExtendDeadlineResult> {
    if (!Number.isFinite(hours) || hours < 1 || hours > MAX_EXTENSION_HOURS) {
      throw new BadRequestException(
        `hours must be between 1 and ${MAX_EXTENSION_HOURS}`,
      );
    }

    const payment = await this.paymentRepo.findOne({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException(`Payment not found: ${paymentId}`);
    }
    if (!DIRECT_CRYPTO_METHODS.has(payment.paymentMethod)) {
      throw new BadRequestException(
        `Deadline extension applies to direct crypto rails only (got ${payment.paymentMethod})`,
      );
    }
    if (!EXTENDABLE_STATUSES.has(payment.status)) {
      throw new BadRequestException(
        `Payment cannot be extended (status=${payment.status})`,
      );
    }
    const escrowAddress = payment.escrowAddress;
    if (!escrowAddress) {
      throw new BadRequestException('Payment has no escrow address');
    }

    const snapshot = await this.relay.readEscrow(escrowAddress);
    if (!snapshot) {
      throw new BadRequestException(`Escrow not found on-chain: ${escrowAddress}`);
    }
    if (this.relay.isFundedOrLater(snapshot)) {
      throw new BadRequestException(
        'Escrow is already funded — nothing to extend',
      );
    }
    if (snapshot.status !== EscrowStatus.AWAITING_FUNDING) {
      // EXPIRED / CANCELLED on-chain: the buyer may already rescue() —
      // extension is impossible by design; refund is the only path.
      throw new BadRequestException(
        `Escrow is no longer awaiting funding on-chain (status=${snapshot.status}). ` +
          'Use the refund path instead.',
      );
    }

    // The Toncoin rail caps its deadline with the rate-lock expiry. If the
    // lock is already dead, extending the escrow alone changes nothing — the
    // admin must explicitly accept honoring the originally locked rate.
    const rateLockExpired = this.rateLockExpiredUnix(payment);
    let rateLockExtended = false;
    if (payment.paymentMethod === PaymentMethod.CRYPTO_TONCOIN && rateLockExpired) {
      if (!options?.extendRateLock) {
        throw new BadRequestException(
          'The rate lock of this Toncoin payment has expired. Pass ' +
            'extendRateLock=true to honor the originally locked rate ' +
            '(the platform takes the TON/USD movement since then), or refund.',
        );
      }
      rateLockExtended = true;
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    const newDeadlineUnix =
      Math.max(nowUnix, snapshot.fundingDeadline) + Math.floor(hours * 3600);

    const txHash = await this.relay.extendFundingDeadline(
      escrowAddress,
      newDeadlineUnix,
    );

    // Revive the payment so the watcher/scanner/manual matching pick it up
    // again. On-chain state is the source of truth; the DB record follows it.
    if (payment.status === PaymentStatus.EXPIRED) {
      payment.status = PaymentStatus.PENDING;
      payment.failureReason = null;
    }
    payment.expiresAt = new Date(newDeadlineUnix * 1000);
    payment.metadata = {
      ...payment.metadata,
      ...(rateLockExtended ? { rateLockExpiresAt: newDeadlineUnix } : {}),
      deadlineExtensions: [
        ...(Array.isArray(payment.metadata?.deadlineExtensions)
          ? (payment.metadata.deadlineExtensions as unknown[])
          : []),
        {
          extendedBy: adminId,
          extendedAt: new Date().toISOString(),
          fromDeadlineUnix: snapshot.fundingDeadline,
          toDeadlineUnix: newDeadlineUnix,
          txHash,
          rateLockExtended,
          note: options?.note ?? null,
        },
      ],
    };
    await this.paymentRepo.save(payment);

    this.logger.warn(
      `Funding deadline of escrow ${escrowAddress} (payment ${payment.id}) ` +
        `extended ${snapshot.fundingDeadline} → ${newDeadlineUnix} by admin ${adminId}` +
        (rateLockExtended ? ' [rate lock honored]' : ''),
    );

    return {
      payment,
      escrowAddress,
      previousDeadlineUnix: snapshot.fundingDeadline,
      newDeadlineUnix,
      txHash,
      rateLockExtended,
    };
  }

  /** True when the payment carries a rate lock that has already expired. */
  private rateLockExpiredUnix(payment: Payment): boolean {
    const raw = payment.metadata?.rateLockExpiresAt;
    if (raw == null) return false;
    const expires = Number(raw);
    if (!Number.isFinite(expires)) return true; // malformed = unusable lock
    return Math.floor(Date.now() / 1000) > expires;
  }
}
