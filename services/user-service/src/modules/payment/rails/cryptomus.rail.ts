import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptomusService, CryptomusPaymentParams } from '../cryptomus.service';
import { Payment } from '../entities/payment.entity';
import { PaymentMethod } from '../enums/payment.enum';
import {
  buildTelegramMiniAppUrl,
  normalizeHostedMiniAppUrl,
} from '../../telegram-bot/telegram-mini-app.util';
import {
  PaymentRail,
  RailInvoice,
  RailInvoiceContext,
  RailStatusResult,
} from './payment-rail.types';

/**
 * Cryptomus hosted-checkout rail. Thin adapter over `CryptomusService`:
 * funds land on the relay hot-wallet, then the webhook flow forwards them
 * into the escrow clone (`PaymentWebhookService.handlePaymentCompleted`).
 *
 * NOTE: Cryptomus does not serve RU/BY — for those markets use the
 * direct USDT rail (or, later, the TON rail).
 */
@Injectable()
export class CryptomusRail implements PaymentRail {
  readonly method = PaymentMethod.CRYPTOMUS;
  readonly label = 'Cryptomus (карта/крипта)';
  readonly kind = 'hosted' as const;

  private readonly logger = new Logger(CryptomusRail.name);
  private readonly backendUrl: string;
  private readonly miniAppUrl: string;
  private readonly miniAppTelegramUrl: string;
  private readonly botUsername: string;
  private readonly configured: boolean;

  constructor(
    private readonly cryptomus: CryptomusService,
    private readonly config: ConfigService,
  ) {
    this.backendUrl = this.config.get<string>('BACKEND_URL', '');
    this.miniAppUrl =
      normalizeHostedMiniAppUrl(this.config.get<string>('MINI_APP_URL', '')) ?? '';
    this.botUsername = this.config.get<string>('TELEGRAM_BOT_USERNAME', '');
    this.miniAppTelegramUrl =
      buildTelegramMiniAppUrl(
        this.botUsername,
        this.config.get<string>('TELEGRAM_MINIAPP_SLUG', 'app'),
      ) ?? '';
    this.configured = Boolean(
      this.config.get<string>('CRYPTOMUS_API_KEY', '') &&
        this.config.get<string>('CRYPTOMUS_MERCHANT_ID', ''),
    );
  }

  isAvailable(): boolean {
    return this.configured;
  }

  async createInvoice(ctx: RailInvoiceContext): Promise<RailInvoice> {
    const returnUrl = this.miniAppUrl
      ? `${this.miniAppUrl.replace(/\/$/, '')}/deals/${ctx.dealId}`
      : this.miniAppTelegramUrl || `https://t.me/${this.botUsername}`;

    const params: CryptomusPaymentParams = {
      amount: ctx.amount.toString(),
      currency: ctx.currency,
      order_id: ctx.orderId,
      url_return: returnUrl,
      url_callback: `${this.backendUrl}/api/webhook/cryptomus`,
      is_payment_multiple: false,
      lifetime: 3600,
    };

    const response = await this.cryptomus.createPayment(params);
    this.logger.log(`Cryptomus invoice created: ${ctx.orderId} → ${response.url}`);

    return {
      paymentUrl: response.url,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      metadata: { cryptomus: response },
    };
  }

  /**
   * Pull-based status check (the push path is the signed webhook).
   * Escrow funding side-effects remain in the webhook/reconciliation flow.
   */
  async checkStatus(payment: Payment): Promise<RailStatusResult> {
    const status = await this.cryptomus.getPaymentStatus(payment.transactionId);
    if (status && status.status === 'paid') {
      return { completed: true, txId: status.txid };
    }
    return { completed: false };
  }
}
