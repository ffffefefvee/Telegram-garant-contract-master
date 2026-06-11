import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import {
  TonUnmatchedDeposit,
  UnmatchedDepositStatus,
} from '../entities/ton-unmatched-deposit.entity';
import { PaymentMethod, PaymentStatus } from '../enums/payment.enum';
import { PaymentService } from '../payment.service';

/**
 * Admin-side recovery for TON deposits the watcher could not attribute
 * (missing/typo'd memo). Matching credits the deposit's units to a payment
 * via `metadata.manualCreditUnits`; the TON rail counts those units exactly
 * like on-chain memo matches, so settlement then runs the standard
 * idempotent funding path (float lock → forwardAndFund → deal funded).
 */
@Injectable()
export class TonRecoveryService {
  private readonly logger = new Logger(TonRecoveryService.name);

  constructor(
    @InjectRepository(TonUnmatchedDeposit)
    private readonly unmatchedRepo: Repository<TonUnmatchedDeposit>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly payments: PaymentService,
  ) {}

  async list(
    status?: UnmatchedDepositStatus,
    limit = 50,
  ): Promise<TonUnmatchedDeposit[]> {
    return this.unmatchedRepo.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
  }

  /**
   * Credit an unmatched deposit to a payment and run settlement.
   * The deposit's units are added to `metadata.manualCreditUnits` BEFORE
   * the deposit row is marked matched — if the process dies in between,
   * re-running match fails on the already-matched row, while the payment
   * keeps the credit (settlement is idempotent on the escrow side).
   */
  async match(
    unmatchedId: string,
    paymentId: string,
    adminId: string,
    note?: string,
  ): Promise<{ deposit: TonUnmatchedDeposit; payment: Payment }> {
    const deposit = await this.unmatchedRepo.findOne({
      where: { id: unmatchedId },
    });
    if (!deposit) {
      throw new NotFoundException(`Unmatched deposit not found: ${unmatchedId}`);
    }
    if (deposit.status !== 'unmatched') {
      throw new BadRequestException(
        `Deposit already resolved (status=${deposit.status})`,
      );
    }

    const payment = await this.paymentRepo.findOne({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException(`Payment not found: ${paymentId}`);
    }
    if (payment.paymentMethod !== PaymentMethod.CRYPTO_TON) {
      throw new BadRequestException(
        'Manual TON matching is only valid for TON-rail payments',
      );
    }
    if (
      payment.status !== PaymentStatus.PENDING &&
      payment.status !== PaymentStatus.PROCESSING
    ) {
      throw new BadRequestException(
        `Payment cannot accept funds (status=${payment.status})`,
      );
    }
    if (!payment.escrowAddress || !payment.metadata?.memo) {
      throw new BadRequestException(
        'Payment has no escrow/memo — not a settled-via-TON payment',
      );
    }

    const previous = this.safeUnits(
      (payment.metadata?.manualCreditUnits as string) ?? '0',
    );
    const credited = previous + this.safeUnits(deposit.amountUnits);
    const matches = Array.isArray(payment.metadata?.manualMatches)
      ? (payment.metadata.manualMatches as unknown[])
      : [];
    payment.metadata = {
      ...payment.metadata,
      manualCreditUnits: credited.toString(),
      manualMatches: [
        ...matches,
        {
          unmatchedDepositId: deposit.id,
          eventId: deposit.eventId,
          amountUnits: deposit.amountUnits,
          matchedBy: adminId,
          matchedAt: new Date().toISOString(),
        },
      ],
    };
    await this.paymentRepo.save(payment);

    deposit.status = 'matched';
    deposit.matchedPaymentId = payment.id;
    deposit.resolvedBy = adminId;
    deposit.resolvedAt = new Date();
    deposit.resolutionNote = note ?? null;
    await this.unmatchedRepo.save(deposit);

    this.logger.log(
      `Unmatched TON deposit ${deposit.id} (${deposit.amountUnits} units) ` +
        `credited to payment ${payment.id} by admin ${adminId}`,
    );

    // Standard settlement path: rail re-checks, sees credited units,
    // funds the Polygon escrow from the float (idempotent).
    const updated = await this.payments.checkPaymentStatus(payment.id);
    return { deposit, payment: updated };
  }

  /** Mark a deposit as handled outside the system (e.g. refunded by hand). */
  async ignore(
    unmatchedId: string,
    adminId: string,
    reason: string,
  ): Promise<TonUnmatchedDeposit> {
    const deposit = await this.unmatchedRepo.findOne({
      where: { id: unmatchedId },
    });
    if (!deposit) {
      throw new NotFoundException(`Unmatched deposit not found: ${unmatchedId}`);
    }
    if (deposit.status !== 'unmatched') {
      throw new BadRequestException(
        `Deposit already resolved (status=${deposit.status})`,
      );
    }
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to ignore a deposit');
    }

    deposit.status = 'ignored';
    deposit.resolvedBy = adminId;
    deposit.resolvedAt = new Date();
    deposit.resolutionNote = reason.trim();
    return this.unmatchedRepo.save(deposit);
  }

  /** Count of open unmatched deposits (used by monitoring alerts). */
  async countUnmatched(): Promise<number> {
    return this.unmatchedRepo.count({ where: { status: 'unmatched' } });
  }

  private safeUnits(value: string): bigint {
    try {
      const units = BigInt(value);
      return units >= 0n ? units : 0n;
    } catch {
      return 0n;
    }
  }
}
