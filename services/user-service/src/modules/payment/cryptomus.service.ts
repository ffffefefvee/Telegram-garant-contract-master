import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface CryptomusPaymentParams {
  amount: string;
  currency: string;
  order_id: string;
  url_return: string;
  url_callback: string;
  is_payment_multiple?: boolean;
  lifetime?: number;
  to_address?: string;
  network?: string;
  currency_from?: string;
}

export interface CryptomusPaymentResponse {
  uuid: string;
  url: string;
  address: string;
  network: string;
  amount: string;
  currency: string;
  order_id: string;
}

export interface CryptomusWebhookPayload {
  type: string;
  uuid: string;
  order_id: string;
  amount: string;
  currency: string;
  currency_amount: string;
  status: string;
  txid: string;
  network: string;
  payer_amount: string;
  payer_currency: string;
}

@Injectable()
export class CryptomusService {
  private readonly logger = new Logger(CryptomusService.name);
  private readonly API_URL = 'https://api.cryptomus.com/v1';
  private readonly apiKey: string;
  private readonly merchantId: string;
  private readonly isSandbox: boolean;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get('CRYPTOMUS_API_KEY', '');
    this.merchantId = this.configService.get('CRYPTOMUS_MERCHANT_ID', '');
    this.isSandbox = this.configService.get('CRYPTOMUS_SANDBOX') === 'true';
  }

  /**
   * Создать платёж (инвойс)
   */
  async createPayment(
    params: CryptomusPaymentParams,
  ): Promise<CryptomusPaymentResponse> {
    const payload = {
      amount: params.amount,
      currency: params.currency || 'USD',
      order_id: params.order_id,
      url_return: params.url_return,
      url_callback: params.url_callback,
      is_payment_multiple: params.is_payment_multiple ?? false,
      lifetime: params.lifetime ?? 3600,
      ...(params.to_address && { to_address: params.to_address }),
      ...(params.network && { network: params.network }),
      ...(params.currency_from && { currency_from: params.currency_from }),
    };

    this.logger.log(`Creating payment: ${JSON.stringify(payload)}`);

    const response = await this.request('/payment', payload);

    this.logger.log(`Payment created: ${JSON.stringify(response)}`);

    return response.result as CryptomusPaymentResponse;
  }

  /**
   * Проверить статус платежа
   */
  async getPaymentStatus(orderId: string): Promise<any> {
    const payload = {
      order_id: orderId,
    };

    const response = await this.request('/payment/info', payload);

    return response.result;
  }

  /**
   * Создать выплату (Payout API)
   * Для вывода средств продавцу
   */
  /**
   * Refund a paid invoice by Cryptomus payment UUID.
   * @see https://doc.cryptomus.com/merchant-api/payments/refund
   */
  async refundPayment(uuid: string): Promise<unknown> {
    const payload = { uuid };
    const response = await this.request('/payment/refund', payload);
    this.logger.log(`Payment refunded: uuid=${uuid}`);
    return response.result;
  }

  async createPayout(
    amount: string,
    currency: string,
    address: string,
    network: string,
  ): Promise<any> {
    const payload = {
      amount,
      currency,
      address,
      network,
    };

    const response = await this.request('/payout', payload);

    this.logger.log(`Payout created: ${JSON.stringify(response)}`);

    return response.result;
  }

  /**
   * Обработать Webhook от Cryptomus
   */
  async handleWebhook(
    payload: CryptomusWebhookPayload,
    signature: string,
  ): Promise<boolean> {
    // Верификация подписи
    if (!this.verifySignature(payload, signature)) {
      this.logger.error('Invalid webhook signature');
      return false;
    }

    this.logger.log(`Webhook received: ${JSON.stringify(payload)}`);

    // Возвращаем true чтобы Cryptomus знал что мы получили
    return true;
  }

  /**
   * Верификация подписи Webhook
   */
  private verifySignature(
    payload: CryptomusWebhookPayload,
    signature: string,
  ): boolean {
    const payloadString = Buffer.from(JSON.stringify(payload)).toString('base64');
    const expectedSignature = crypto
      .createHash('md5')
      .update(payloadString + this.apiKey)
      .digest('hex');

    return expectedSignature === signature;
  }

  /**
   * HTTP запрос к API Cryptomus
   */
  private async request(endpoint: string, payload: any): Promise<any> {
    const url = `${this.API_URL}${endpoint}`;

    // Создаём подпись
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sign = crypto
      .createHash('md5')
      .update(payloadBase64 + this.apiKey)
      .digest('hex');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'merchant': this.merchantId,
        'sign': sign,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Cryptomus API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.state !== 0) {
      throw new Error(`Cryptomus API error: ${data.message || 'Unknown error'}`);
    }

    return data;
  }
}
