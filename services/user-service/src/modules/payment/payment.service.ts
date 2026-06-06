import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Payment } from './entities/payment.entity';
import { PaymentStatus, PaymentType } from './enums/payment.enum';
import { CryptomusService, CryptomusPaymentParams } from './cryptomus.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CommissionConfigService } from './commission-config.service';
import { buildTelegramMiniAppUrl, normalizeHostedMiniAppUrl } from '../telegram-bot/telegram-mini-app.util';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly backendUrl: string;
  private readonly miniAppUrl: string;
  private readonly miniAppTelegramUrl: string;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly cryptomusService: CryptomusService,
    private readonly configService: ConfigService,
    private readonly commissionConfig: CommissionConfigService,
  ) {
    // BACKEND_URL must be a publicly-reachable HTTPS URL so Cryptomus can POST webhooks.
    this.backendUrl = this.configService.get<string>('BACKEND_URL', '');
    const rawMiniAppUrl = this.configService.get<string>('MINI_APP_URL', '');
    // MINI_APP_URL must point to the hosted HTTPS mini-app, not to a t.me deeplink.
    this.miniAppUrl = normalizeHostedMiniAppUrl(rawMiniAppUrl) ?? '';
    this.miniAppTelegramUrl = buildTelegramMiniAppUrl(
      this.configService.get<string>('TELEGRAM_BOT_USERNAME', ''),
      this.configService.get<string>('TELEGRAM_MINIAPP_SLUG', 'app'),
    ) ?? '';
    if (!this.backendUrl) {
      this.logger.warn(
        'BACKEND_URL is not set — Cryptomus webhooks will not reach this service. Set BACKEND_URL to the public HTTPS URL of this backend.',
      );
    }
    if (rawMiniAppUrl && !this.miniAppUrl) {
      this.logger.warn(
        'Ignoring MINI_APP_URL for payment return URL because it must be a hosted HTTPS mini-app URL, not a Telegram deeplink.',
      );
    }
  }

  /**
   * Создать платёж через Cryptomus
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
    },
  ): Promise<{
    payment: Payment;
    paymentUrl: string;
    expiresAt: Date;
  }> {
    const currency = options?.currency || 'USD';
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
      } else if (existingPayment.paymentUrl) {
        return {
          payment: existingPayment,
          paymentUrl: existingPayment.paymentUrl,
          expiresAt: existingPayment.expiresAt ?? new Date(Date.now() + 3600 * 1000),
        };
      }
    }

    // Создаём запись в БД
    const payment = this.paymentRepository.create({
      transactionId: orderId,
      type: PaymentType.DEAL_PAYMENT,
      userId,
      dealId,
      amount,
      currency,
      fee: await this.commissionConfig.calculateDealFee(amount),
      status: PaymentStatus.PENDING,
      description: options?.description || `Payment for deal ${dealId}`,
      escrowAddress: options?.escrowAddress,
    });

    const savedPayment = await this.paymentRepository.save(payment);

    // Cryptomus does NOT support to_address for directing funds to an arbitrary wallet.
    // The relay pattern is used instead: funds land on the hot-wallet, then
    // PaymentWebhookService.handlePaymentWebhook forwards them to the escrow contract.
    const returnUrl = this.miniAppUrl
      ? `${this.miniAppUrl.replace(/\/$/, '')}/deals/${dealId}`
      : this.miniAppTelegramUrl || `https://t.me/${this.configService.get('TELEGRAM_BOT_USERNAME', '')}`;
    const cryptomusParams: CryptomusPaymentParams = {
      amount: amount.toString(),
      currency,
      order_id: orderId,
      url_return: returnUrl,
      url_callback: `${this.backendUrl}/api/webhook/cryptomus`,
      is_payment_multiple: false,
      lifetime: 3600,
      ...(options?.network && { network: options.network }),
    };

    try {
      const cryptomusResponse = await this.cryptomusService.createPayment(cryptomusParams);

      // Сохраняем данные Cryptomus
      savedPayment.cryptomusData = cryptomusResponse;
      savedPayment.paymentUrl = cryptomusResponse.url;
      savedPayment.expiresAt = new Date(Date.now() + 3600 * 1000);

      await this.paymentRepository.save(savedPayment);

      this.logger.log(`Payment created: ${orderId}, URL: ${cryptomusResponse.url}`);

      return {
        payment: savedPayment,
        paymentUrl: cryptomusResponse.url,
        expiresAt: savedPayment.expiresAt,
      };
    } catch (error) {
      savedPayment.markAsFailed((error as Error).message);
      await this.paymentRepository.save(savedPayment);
      this.logger.error(`Cryptomus payment creation failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Payment creation failed: ${error.message}`);
    }
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
   * Проверить статус платежа в Cryptomus
   */
  async checkPaymentStatus(paymentId: string): Promise<Payment> {
    const payment = await this.findById(paymentId);

    if (payment.status === PaymentStatus.COMPLETED) {
      return payment;
    }

    const status = await this.cryptomusService.getPaymentStatus(payment.transactionId);

    if (status && status.status === 'paid') {
      payment.status = PaymentStatus.COMPLETED;
      payment.paidAt = new Date();
      payment.txId = status.txid;
      await this.paymentRepository.save(payment);
    }

    return payment;
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
