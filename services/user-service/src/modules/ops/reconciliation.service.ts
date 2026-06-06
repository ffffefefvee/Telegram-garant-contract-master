import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Payment } from '../payment/entities/payment.entity';
import { PaymentStatus } from '../payment/enums/payment.enum';
import { Deal } from '../deal/entities/deal.entity';
import { DealStatus } from '../deal/enums/deal.enum';
import { EscrowService } from '../escrow/escrow.service';
import { DealService } from '../deal/deal.service';

export interface ReconciliationReport {
  payments: {
    scanned: number;
    forwarded: number;
    skipped: number;
    failed: number;
  };
  notes: string[];
}

/**
 * Periodically sweeps up partial state left behind by the live request
 * path (Cryptomus webhook). Designed to be safe to run at any interval —
 * every operation is idempotent.
 *
 *  - Payments: completed but their Deal is still PENDING_PAYMENT and has
 *    both wallets attached → call EscrowService.forwardAndFund and
 *    transition the deal. Catches the case where wallets were attached
 *    AFTER payment landed, or where the live forwardAndFund call failed
 *    transiently.
 *
 * Dispute on-chain reconciliation (resyncing failed assignArbitrator
 * calls, verifying resolve() tx hashes) lives in a follow-up PR layered on
 * top of the dispute-bridge service introduced in H1S2 PR 5/6.
 *
 * The orchestrator (cron / queue) is wired separately in
 * `reconciliation.scheduler.ts` so this service stays unit-testable.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
    private readonly escrow: EscrowService,
    @Inject(forwardRef(() => DealService))
    private readonly dealService: DealService,
  ) {}

  async runOnce(): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      payments: { scanned: 0, forwarded: 0, skipped: 0, failed: 0 },
      notes: [],
    };

    if (!this.escrow.isEnabled()) {
      report.notes.push('blockchain disabled — reconciliation skipped');
      return report;
    }

    await this.reconcilePayments(report);
    return report;
  }

  private async reconcilePayments(report: ReconciliationReport): Promise<void> {
    const candidates = await this.paymentRepo.find({
      where: {
        status: PaymentStatus.COMPLETED,
        dealId: Not(IsNull()),
      },
      relations: ['deal', 'deal.buyer', 'deal.seller'],
      take: 100,
    });

    for (const payment of candidates) {
      report.payments.scanned += 1;
      const deal = payment.deal;
      if (!deal) {
        report.payments.skipped += 1;
        continue;
      }
      if (deal.status !== DealStatus.PENDING_PAYMENT) {
        // Already moved past the bridge step — happy path or terminal.
        report.payments.skipped += 1;
        continue;
      }
      const buyerWallet = deal.buyer?.walletAddress ?? null;
      const sellerWallet = deal.seller?.walletAddress ?? null;
      if (!buyerWallet || !sellerWallet) {
        report.payments.skipped += 1;
        continue;
      }

      try {
        if (!deal.escrowAddress) {
          const created = await this.escrow.createEscrow(
            deal.id,
            buyerWallet,
            sellerWallet,
            Number(deal.amount),
          );
          deal.escrowAddress = created.escrowAddress;
        }
        await this.escrow.forwardAndFund(deal.id, Number(deal.amount));
        await this.dealService.confirmPayment(
          deal.id,
          Number(payment.amount),
          payment.currency,
        );
        report.payments.forwarded += 1;
        this.logger.log(
          `Reconciled payment ${payment.id} → deal ${deal.id} forwarded`,
        );
      } catch (err) {
        report.payments.failed += 1;
        this.logger.warn(
          `Reconciliation failed for payment ${payment.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Daily reconciliation summary for admin dashboards. */
  async buildDailyReport(): Promise<{
    generatedAt: string;
    completedPayments: number;
    dealsInProgress: number;
    dealsPendingPayment: number;
    dealsStuckPendingPayment: number;
    rows: Array<{
      paymentId: string;
      dealId: string;
      dealStatus: string;
      paidAt: string | null;
      escrowAddress: string | null;
    }>;
  }> {
    const completedPayments = await this.paymentRepo.count({
      where: { status: PaymentStatus.COMPLETED },
    });
    const dealsInProgress = await this.dealRepo.count({
      where: { status: DealStatus.IN_PROGRESS },
    });
    const dealsPendingPayment = await this.dealRepo.count({
      where: { status: DealStatus.PENDING_PAYMENT },
    });

    const stuck = await this.paymentRepo.find({
      where: { status: PaymentStatus.COMPLETED, dealId: Not(IsNull()) },
      relations: ['deal'],
      take: 200,
    });
    const stuckRows = stuck.filter((p) => p.deal?.status === DealStatus.PENDING_PAYMENT);

    return {
      generatedAt: new Date().toISOString(),
      completedPayments,
      dealsInProgress,
      dealsPendingPayment,
      dealsStuckPendingPayment: stuckRows.length,
      rows: stuckRows.map((p) => ({
        paymentId: p.id,
        dealId: p.dealId!,
        dealStatus: p.deal!.status,
        paidAt: p.paidAt?.toISOString() ?? null,
        escrowAddress: p.deal!.escrowAddress ?? null,
      })),
    };
  }
}
