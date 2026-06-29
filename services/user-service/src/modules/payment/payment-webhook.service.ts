import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Payment } from './entities/payment.entity';
import { CryptomusWebhookPayload } from './cryptomus.service';
import { Deal } from '../deal/entities/deal.entity';
import { DealStatus, Currency } from '../deal/enums/deal.enum';
import { EscrowService } from '../escrow/escrow.service';
import { DealService } from '../deal/deal.service';
import { AuditLogService } from '../ops/audit-log.service';
import { WebhookIdempotencyService } from './webhook-idempotency.service';
import { normalizeUsdtAmount } from '../escrow/usdt-amount';

/** Identifies Cryptomus rows in the shared processed-webhook-events ledger. */
const WEBHOOK_PROVIDER_CRYPTOMUS = 'cryptomus';

export enum WebhookStatus {
  PAID = 'paid',
  REFUNDED = 'refunded',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  PROCESSING = 'processing',
}

/**
 * Result of a webhook processing pass. Lets the caller (and tests) inspect
 * what side-effects fired.
 */
export interface WebhookProcessingResult {
  paymentStatus: string;
  dealId: string | null;
  escrowAddress: string | null;
  forwarded: boolean;
  /** Hash of the USDT transfer + notifyFunded if we forwarded. */
  txHashes: { transfer?: string; notify?: string };
  /** Human-readable message for non-fatal skips. */
  notes: string[];
}

@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Deal)
    private readonly dealRepository: Repository<Deal>,
    @Inject(forwardRef(() => EscrowService))
    private readonly escrow: EscrowService,
    @Inject(forwardRef(() => DealService))
    private readonly dealService: DealService,
    private readonly auditLog: AuditLogService,
    private readonly idempotency: WebhookIdempotencyService,
  ) {}

  /**
   * Entry point invoked by `CryptomusWebhookController` after HMAC has been
   * verified. Routes by `status`. Idempotent — a re-delivered PAID webhook
   * for a deal whose escrow is already FUNDED will skip forwarding and
   * just record the duplicate hit.
   */
  async handlePaymentWebhook(
    payload: CryptomusWebhookPayload,
  ): Promise<WebhookProcessingResult> {
    const { order_id, status, txid, currency_amount } = payload;
    this.logger.log(
      `Processing webhook order=${order_id} status=${status} txid=${txid}`,
    );

    const payment = await this.paymentRepository.findOne({
      where: { transactionId: order_id },
      relations: ['deal'],
    });
    if (!payment) {
      this.logger.error(`Payment not found: ${order_id}`);
      throw new NotFoundException(`Payment not found: ${order_id}`);
    }

    switch (status) {
      case WebhookStatus.PAID:
        return this.handlePaymentCompleted(payment, txid, currency_amount);
      case WebhookStatus.PROCESSING:
        return this.handlePaymentProcessing(payment);
      case WebhookStatus.REFUNDED:
        return this.handlePaymentRefunded(payment);
      case WebhookStatus.CANCELLED:
      case WebhookStatus.EXPIRED:
        return this.handlePaymentFailed(payment, status);
      default:
        this.logger.warn(`Unknown webhook status: ${status}`);
        return this.emptyResult(payment, [`unknown status: ${status}`]);
    }
  }

  /**
   * Successful Cryptomus payment. We:
   *   1. Mark the Payment row paid (idempotent).
   *   2. Look up the Deal (if any).
   *   3. If the Deal has both wallets attached and no escrow deployed yet,
   *      deploy the clone now.
   *   4. Forward USDT from the relay hot-wallet to the clone and call
   *      notifyFunded() on the clone.
   *   5. Transition the Deal to IN_PROGRESS.
   *
   * Any of (3)-(5) may legitimately skip with a recorded note (see returned
   * `notes`). The caller must NOT 5xx on these — Cryptomus would retry
   * forever. Reconciliation (PR 6/6) sweeps up partials later.
   */
  private async handlePaymentCompleted(
    payment: Payment,
    txid: string,
    cryptoAmount: string,
  ): Promise<WebhookProcessingResult> {
    const notes: string[] = [];

    payment.status = 'completed' as Payment['status'];
    payment.paidAt = payment.paidAt ?? new Date();
    payment.txId = txid;
    // Parse at the money boundary: a malformed/empty amount must not become
    // NaN in the decimal column. normalizeUsdtAmount returns null on garbage,
    // in which case we leave cryptoAmount untouched (FX fallback handles it).
    const normalizedCrypto = normalizeUsdtAmount(cryptoAmount);
    if (normalizedCrypto !== null) {
      payment.cryptoAmount = normalizedCrypto;
    }
    payment.cryptomusData = {
      ...payment.cryptomusData,
      paidAt: new Date().toISOString(),
      txid,
    };
    await this.paymentRepository.save(payment);

    await this.auditLog.write({
      aggregateType: 'payment',
      aggregateId: payment.id,
      action: 'payment.completed',
      details: { orderId: payment.transactionId, txid, dealId: payment.dealId },
    });

    const deal = payment.deal ?? (
      payment.dealId
        ? await this.dealRepository.findOne({
            where: { id: payment.dealId },
            relations: ['buyer', 'seller'],
          })
        : null
    );
    if (!deal) {
      notes.push('payment has no associated deal — recorded paid only');
      return {
        paymentStatus: 'completed',
        dealId: null,
        escrowAddress: null,
        forwarded: false,
        txHashes: {},
        notes,
      };
    }

    const buyerWallet = deal.buyer?.walletAddress ?? null;
    const sellerWallet = deal.seller?.walletAddress ?? null;
    if (!buyerWallet || !sellerWallet) {
      notes.push(
        `wallets missing (buyer=${!!buyerWallet} seller=${!!sellerWallet}); reconciliation will retry`,
      );
      return {
        paymentStatus: 'completed',
        dealId: deal.id,
        escrowAddress: deal.escrowAddress,
        forwarded: false,
        txHashes: {},
        notes,
      };
    }

    const amountUsdt = await this.lockFundingFx(deal, cryptoAmount);

    let escrowAddress = deal.escrowAddress;
    if (!escrowAddress) {
      try {
        const result = await this.escrow.createEscrow(
          deal.id,
          buyerWallet,
          sellerWallet,
          amountUsdt,
        );
        escrowAddress = result.escrowAddress;
        deal.escrowAddress = escrowAddress;
        await this.dealRepository.save(deal);
        this.logger.log(`Escrow deployed JIT for deal ${deal.id} @ ${escrowAddress}`);
      } catch (err) {
        notes.push(
          `JIT escrow deploy failed: ${(err as Error).message}; reconciliation will retry`,
        );
        return {
          paymentStatus: 'completed',
          dealId: deal.id,
          escrowAddress: null,
          forwarded: false,
          txHashes: {},
          notes,
        };
      }
    }

    if (escrowAddress === ethers.ZeroAddress) {
      notes.push('escrow address is zero — cannot forward');
      return {
        paymentStatus: 'completed',
        dealId: deal.id,
        escrowAddress,
        forwarded: false,
        txHashes: {},
        notes,
      };
    }

    if (!this.escrow.isEnabled()) {
      notes.push('blockchain disabled (stub mode) — skipping forward+notify');
      await this.transitionDealToInProgress(deal, payment);
      return {
        paymentStatus: 'completed',
        dealId: deal.id,
        escrowAddress,
        forwarded: false,
        txHashes: {},
        notes,
      };
    }

    // Idempotency guard: never forward twice for the same order. A duplicate
    // `paid` webhook (Cryptomus retry / manual replay) or a deal already
    // funded by reconciliation must NOT trigger a second USDT transfer from
    // the relay hot-wallet — that would be real money lost.
    const alreadyForwarded = await this.idempotency.isProcessed(
      WEBHOOK_PROVIDER_CRYPTOMUS,
      payment.transactionId,
    );
    if (alreadyForwarded || deal.status !== DealStatus.PENDING_PAYMENT) {
      notes.push('escrow already funded for this order — skipping forward (idempotent)');
      await this.transitionDealToInProgress(deal, payment);
      return {
        paymentStatus: 'completed',
        dealId: deal.id,
        escrowAddress,
        forwarded: false,
        txHashes: {},
        notes,
      };
    }

    try {
      const forwardResult = await this.escrow.forwardAndFund(deal.id, amountUsdt);
      this.logger.log(
        `Escrow funded for deal ${deal.id}: transfer=${forwardResult.transferTxHash} notify=${forwardResult.notifyTxHash}`,
      );
      await this.auditLog.write({
        aggregateType: 'deal',
        aggregateId: deal.id,
        action: 'escrow.funded',
        details: {
          escrowAddress,
          transferTx: forwardResult.transferTxHash,
          notifyTx: forwardResult.notifyTxHash,
        },
      });
      // Record the funding so any re-delivery of this `paid` event is a no-op.
      // Done only after the transfer succeeded — a failure above leaves no
      // row, so the provider retry (or reconciliation) can still fund later.
      await this.idempotency.markProcessed({
        provider: WEBHOOK_PROVIDER_CRYPTOMUS,
        eventKey: payment.transactionId,
        orderId: payment.transactionId,
        status: 'paid',
      });
      await this.transitionDealToInProgress(deal, payment);
      return {
        paymentStatus: 'completed',
        dealId: deal.id,
        escrowAddress,
        forwarded: true,
        txHashes: {
          transfer: forwardResult.transferTxHash ?? undefined,
          notify: forwardResult.notifyTxHash ?? undefined,
        },
        notes,
      };
    } catch (err) {
      this.logger.error(
        `Escrow forward+notify failed for deal ${deal.id}: ${(err as Error).message}`,
      );
      notes.push(`forward+notify failed: ${(err as Error).message}; reconciliation will retry`);
      return {
        paymentStatus: 'completed',
        dealId: deal.id,
        escrowAddress,
        forwarded: false,
        txHashes: {},
        notes,
      };
    }
  }

  /**
   * Lock RUB→USDT (or native USDT) at funding time using Cryptomus snapshot.
   */
  private async lockFundingFx(deal: Deal, cryptoAmount: string): Promise<number> {
    // Parse the provider string without a float round-trip; null on garbage.
    const fromWebhook = normalizeUsdtAmount(cryptoAmount);
    if (fromWebhook !== null && fromWebhook > 0) {
      deal.amountUsdt = fromWebhook;
      deal.fxRateLockedAt = new Date();
      if (deal.quoteAmount == null) {
        deal.quoteAmount = Number(deal.amount);
      }
      if (!deal.quoteCurrency) {
        deal.quoteCurrency =
          deal.currency === Currency.USDT ? 'USDT' : 'RUB';
      }
      await this.dealRepository.save(deal);
      this.logger.log(
        `FX locked for deal ${deal.id}: ${deal.amountUsdt} USDT @ ${deal.fxRateLockedAt.toISOString()}`,
      );
      return fromWebhook;
    }

    if (deal.amountUsdt != null && Number(deal.amountUsdt) > 0) {
      return Number(deal.amountUsdt);
    }


    const quote =
      deal.quoteCurrency === 'USDT' || deal.currency === Currency.USDT
        ? Number(deal.quoteAmount ?? deal.amount)
        : Number(deal.amount);

    deal.amountUsdt = quote;
    deal.fxRateLockedAt = new Date();
    if (deal.quoteAmount == null) {
      deal.quoteAmount = Number(deal.amount);
    }
    if (!deal.quoteCurrency) {
      deal.quoteCurrency =
        deal.currency === Currency.USDT ? 'USDT' : 'RUB';
    }
    await this.dealRepository.save(deal);
    this.logger.warn(
      `Webhook missing currency_amount for deal ${deal.id}; using quote fallback ${quote} USDT`,
    );
    return quote;
  }

  /**
   * Settlement for the direct USDT rail: by the time this is called the
   * escrow clone is already FUNDED on-chain (buyer paid the clone address
   * directly and the rail fired notifyFunded). No fund forwarding — we only
   * audit-log and move the deal to IN_PROGRESS.
   */
  async finalizeDirectPayment(
    payment: Payment,
    details: { txId?: string; fundedUsdt?: number },
  ): Promise<void> {
    await this.auditLog.write({
      aggregateType: 'payment',
      aggregateId: payment.id,
      action: 'payment.completed',
      details: {
        orderId: payment.transactionId,
        method: 'direct_usdt',
        txid: details.txId ?? null,
        fundedUsdt: details.fundedUsdt ?? null,
        dealId: payment.dealId,
        escrowAddress: payment.escrowAddress,
      },
    });

    if (!payment.dealId) {
      return;
    }
    const deal =
      payment.deal ??
      (await this.dealRepository.findOne({ where: { id: payment.dealId } }));
    if (!deal) {
      this.logger.warn(
        `Direct payment ${payment.id} completed but deal ${payment.dealId} not found`,
      );
      return;
    }

    await this.auditLog.write({
      aggregateType: 'deal',
      aggregateId: deal.id,
      action: 'escrow.funded',
      details: {
        escrowAddress: payment.escrowAddress,
        notifyTx: details.txId ?? null,
        rail: 'direct_usdt',
      },
    });
    await this.transitionDealToInProgress(deal, payment);
  }

  private async transitionDealToInProgress(deal: Deal, payment: Payment): Promise<void> {
    if (deal.status === DealStatus.IN_PROGRESS || deal.status === DealStatus.COMPLETED) {
      return;
    }
    if (deal.status === DealStatus.PENDING_PAYMENT) {
      try {
        await this.dealService.confirmPayment(
          deal.id,
          Number(payment.amount),
          payment.currency,
        );
        return;
      } catch (err) {
        this.logger.warn(
          `confirmPayment failed for deal ${deal.id}: ${(err as Error).message}; falling back to direct status update`,
        );
      }
    }
    deal.status = DealStatus.IN_PROGRESS;
    deal.paidAt = deal.paidAt ?? new Date();
    await this.dealRepository.save(deal);
  }

  private async handlePaymentProcessing(payment: Payment): Promise<WebhookProcessingResult> {
    payment.status = 'processing' as Payment['status'];
    await this.paymentRepository.save(payment);
    return this.emptyResult(payment, ['payment processing']);
  }

  private async handlePaymentRefunded(payment: Payment): Promise<WebhookProcessingResult> {
    payment.status = 'refunded' as Payment['status'];
    payment.refundedAt = new Date();
    await this.paymentRepository.save(payment);
    return this.emptyResult(payment, ['payment refunded']);
  }

  private async handlePaymentFailed(
    payment: Payment,
    status: string,
  ): Promise<WebhookProcessingResult> {
    payment.status = 'failed' as Payment['status'];
    payment.failureReason = `Payment ${status}`;
    await this.paymentRepository.save(payment);
    return this.emptyResult(payment, [`payment ${status}`]);
  }

  private emptyResult(payment: Payment, notes: string[]): WebhookProcessingResult {
    return {
      paymentStatus: payment.status,
      dealId: payment.dealId,
      escrowAddress: null,
      forwarded: false,
      txHashes: {},
      notes,
    };
  }
}
