import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentMethod, PaymentStatus, PaymentType } from './enums/payment.enum';
import { CryptomusService } from './cryptomus.service';
import { CommissionConfigService } from './commission-config.service';
import { RailRegistryService, RailDescriptor } from './rails/rail-registry.service';
import { RailStatusResult } from './rails/payment-rail.types';
import { PaymentWebhookService } from './payment-webhook.service';

export interface CreatedPaymentResult {
  payment: Payment;
  /** Hosted checkout URL (gateway rails). */
  paymentUrl?: string;
  /** Direct on-chain deposit details (direct rails). */
  deposit?: {
    address: string;
    network: string;
    asset: string;
    /** Exact amount the buyer must send (deal amount + buyer fee). */
    requiredAmount: string;
  };
  expiresAt: Date;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly cryptomusService: CryptomusService,
    private readonly commissionConfig: CommissionConfigService,
    private readonly rails: RailRegistryService,
    private readonly webhookService: PaymentWebhookService,
  ) {}

  /** Rails the mini-app can offer right now. */
  listPaymentMethods(): RailDescriptor[] {
    return this.rails.list();
  }

  /**
   * Создать платёж через выбранный рельс (Cryptomus по умолчанию,
   * прямой USDT-депозит на адрес эскроу — method='crypto').
   */
  async createPayment(
    dealId: string,
    amount: number,
    userId: string,
    options?: {
      currency?: string;
      description?: string;
      escrowAddress?: string;
      network?: string;
      method?: PaymentMethod;
    },
  ): Promise<CreatedPaymentResult> {
    const method = options?.method ?? PaymentMethod.CRYPTOMUS;
    const rail = this.rails.get(method);
    const currency =
      options?.currency || (method === PaymentMethod.CRYPTO ? 'USDT' : 'USD');
    const orderId = `DEAL_${dealId}_${Date.now()}`;

    const existingPayment = await this.paymentRepository.findOne({
      where: {
        dealId,
        userId,
        type: PaymentType.DEAL_PAYMENT,
        status: PaymentStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    if (existingPayment) {
      if (existingPayment.isExpired) {
        existingPayment.markAsExpired();
        await this.paymentRepository.save(existingPayment);
      } else if (existingPayment.paymentMethod === method) {
        const reusable = this.toCreatedResult(existingPayment);
        if (reusable.paymentUrl || reusable.deposit) {
          return reusable;
        }
      }
      // A pending payment on a DIFFERENT rail stays pending — the buyer may
      // legitimately switch methods; both point at the same deal/escrow and
      // settlement is idempotent on-chain.
    }

    const payment = this.paymentRepository.create({
      transactionId: orderId,
      type: PaymentType.DEAL_PAYMENT,
      userId,
      dealId,
      amount,
      currency,
      paymentMethod: method,
      fee: await this.commissionConfig.calculateDealFee(amount),
      status: PaymentStatus.PENDING,
      description: options?.description || `Payment for deal ${dealId}`,
      escrowAddress: options?.escrowAddress,
    });

    const savedPayment = await this.paymentRepository.save(payment);

    try {
      const invoice = await rail.createInvoice({
        dealId,
        userId,
        amount,
        currency,
        description: savedPayment.description ?? '',
        orderId,
      });

      savedPayment.paymentUrl = invoice.paymentUrl ?? null;
      savedPayment.walletAddress = invoice.depositAddress ?? null;
      if (invoice.depositAddress) {
        savedPayment.escrowAddress = invoice.depositAddress;
      }
      savedPayment.expiresAt = invoice.expiresAt;
      if (invoice.metadata) {
        savedPayment.metadata = { ...savedPayment.metadata, ...invoice.metadata };
        if (invoice.metadata['cryptomus']) {
          savedPayment.cryptomusData = invoice.metadata[
            'cryptomus'
          ] as Record<string, any>;
        }
      }
      if (invoice.network) {
        savedPayment.metadata = {
          ...savedPayment.metadata,
          network: invoice.network,
          asset: invoice.asset,
          requiredAmount: invoice.requiredAmount,
        };
      }

      await this.paymentRepository.save(savedPayment);
      this.logger.log(
        `Payment created: ${orderId} method=${method} ` +
          (invoice.paymentUrl
            ? `url=${invoice.paymentUrl}`
            : `deposit=${invoice.depositAddress}`),
      );

      return this.toCreatedResult(savedPayment);
    } catch (error) {
      savedPayment.markAsFailed((error as Error).message);
      await this.paymentRepository.save(savedPayment);
      this.logger.error(
        `Payment creation failed (${method}): ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new BadRequestException(
        `Payment creation failed: ${(error as Error).message}`,
      );
    }
  }

  private toCreatedResult(payment: Payment): CreatedPaymentResult {
    const result: CreatedPaymentResult = {
      payment,
      expiresAt: payment.expiresAt ?? new Date(Date.now() + 3600 * 1000),
    };
    if (payment.paymentUrl) {
      result.paymentUrl = payment.paymentUrl;
    }
    if (
      payment.paymentMethod === PaymentMethod.CRYPTO &&
      payment.escrowAddress
    ) {
      result.deposit = {
        address: payment.escrowAddress,
        network: (payment.metadata?.network as string) ?? 'polygon',
        asset: (payment.metadata?.asset as string) ?? 'USDT',
        requiredAmount:
          (payment.metadata?.requiredAmount as string) ??
          String(payment.totalAmount),
      };
    }
    return result;
  }

  /**
   * Получить платёж по ID
   */
  async findById(id: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id },
      relations: ['deal'],
    });

    if (!payment) {
      throw new NotFoundException(`Payment not found: ${id}`);
    }

    return payment;
  }

  /**
   * Получить платежи пользователя
   */
  async getUserPayments(
    userId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ payments: Payment[]; total: number }> {
    const [payments, total] = await this.paymentRepository.findAndCount({
      where: { userId },
      relations: ['deal'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { payments, total };
  }

  /**
   * Проверить статус платежа на его рельсе (Cryptomus pull-check или
   * on-chain проверка прямого депозита). Идемпотентно; используется и
   * кнопкой «Проверить» в mini-app, и фоновым вотчером.
   */
  async checkPaymentStatus(paymentId: string): Promise<Payment> {
    const payment = await this.findById(paymentId);

    if (payment.status === PaymentStatus.COMPLETED) {
      return payment;
    }
    if (
      payment.status !== PaymentStatus.PENDING &&
      payment.status !== PaymentStatus.PROCESSING
    ) {
      return payment;
    }

    const rail = this.rails.get(payment.paymentMethod);
    const result = await rail.checkStatus(payment);
    return this.applyRailStatus(payment, result);
  }

  /**
   * Persist a rail status check and run settlement side-effects.
   * Direct rail: the escrow is already FUNDED on-chain at this point, so we
   * mark the payment paid and transition the deal — no fund forwarding.
   */
  private async applyRailStatus(
    payment: Payment,
    result: RailStatusResult,
  ): Promise<Payment> {
    if (result.completed) {
      payment.markAsCompleted();
      payment.txId = result.txId ?? payment.txId;
      if (result.fundedUsdt != null) {
        payment.cryptoAmount = result.fundedUsdt;
        payment.cryptoCurrency = 'USDT';
      }
      await this.paymentRepository.save(payment);

      if (payment.paymentMethod === PaymentMethod.CRYPTO) {
        await this.webhookService.finalizeDirectPayment(payment, {
          txId: result.txId,
          fundedUsdt: result.fundedUsdt,
        });
      }
      return payment;
    }

    if (result.expired) {
      payment.markAsExpired();
      payment.failureReason = 'Funding deadline passed';
      await this.paymentRepository.save(payment);
      return payment;
    }

    if (result.receivedUsdt != null && result.receivedUsdt > 0) {
      payment.status = PaymentStatus.PROCESSING;
      payment.metadata = {
        ...payment.metadata,
        receivedUsdt: result.receivedUsdt,
        requiredUsdt: result.requiredUsdt,
        lastCheckedAt: new Date().toISOString(),
      };
      await this.paymentRepository.save(payment);
    }

    return payment;
  }

  /** Pending/processing direct-deposit payments for the background watcher. */
  async findOpenDirectPayments(limit = 100): Promise<Payment[]> {
    return this.paymentRepository
      .createQueryBuilder('payment')
      .where('payment.paymentMethod = :method', { method: PaymentMethod.CRYPTO })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [PaymentStatus.PENDING, PaymentStatus.PROCESSING],
      })
      .andWhere('payment.escrowAddress IS NOT NULL')
      .orderBy('payment.createdAt', 'ASC')
      .take(limit)
      .getMany();
  }

  async refundPayment(paymentId: string, reason: string, userId: string): Promise<Payment> {
    const payment = await this.findById(paymentId);

    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Can only refund completed payments');
    }

    if (payment.cryptomusData?.uuid) {
      try {
        await this.cryptomusService.refundPayment(payment.cryptomusData.uuid);
      } catch (err) {
        this.logger.error(
          `Cryptomus refund failed for ${payment.id}: ${(err as Error).message}`,
        );
        throw new BadRequestException(
          `Cryptomus refund failed: ${(err as Error).message}`,
        );
      }
    }

    payment.status = PaymentStatus.REFUNDED;
    payment.refundReason = reason;
    payment.refundedAt = new Date();
    payment.refundedBy = userId;

    return this.paymentRepository.save(payment);
  }

  async findAllForAdmin(
    page: number = 1,
    limit: number = 20,
    status?: string,
  ): Promise<{ payments: Payment[]; total: number }> {
    const where = status ? { status: status as Payment['status'] } : {};
    const [payments, total] = await this.paymentRepository.findAndCount({
      where,
      relations: ['user', 'deal'],
      take: limit,
      skip: (page - 1) * limit,
      order: { createdAt: 'DESC' },
    });
    return { payments, total };
  }

  /** Completed payments whose deal is still awaiting funding (stuck). */
  async findStuckFunding(limit = 50): Promise<Payment[]> {
    return this.paymentRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.deal', 'deal')
      .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
      .andWhere('deal.status = :dealStatus', { dealStatus: 'pending_payment' })
      .orderBy('payment.paidAt', 'DESC')
      .take(limit)
      .getMany();
  }

  async checkCryptomusStatus(paymentId: string): Promise<any> {
    const payment = await this.findById(paymentId);
    return this.cryptomusService.getPaymentStatus(payment.transactionId);
  }

  async getStats(): Promise<{ totalProcessed: number; totalAmount: number }> {
    const result = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('COUNT(*)', 'totalProcessed')
      .addSelect('SUM(payment.amount)', 'totalAmount')
      .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
      .getRawOne();
    return { totalProcessed: parseInt(result?.totalProcessed || '0'), totalAmount: parseFloat(result?.totalAmount || '0') };
  }

}
