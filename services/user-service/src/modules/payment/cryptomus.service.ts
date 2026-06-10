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
  /** Cryptomus includes the signature inside the body as well. */
  sign?: string;
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
    rawBody?: Buffer | string,
  ): Promise<boolean> {
    // Fail closed: with no API key configured an attacker could forge a
    // valid signature for md5(base64(body) + ''). Never accept webhooks
    // until CRYPTOMUS_API_KEY is set.
    if (!this.apiKey) {
      this.logger.error(
        'CRYPTOMUS_API_KEY is not configured — rejecting webhook (fail closed)',
      );
      return false;
    }

    // Верификация подписи
    if (!this.verifySignature(payload, signature, rawBody)) {
      this.logger.error('Invalid webhook signature');
      return false;
    }

    this.logger.log(`Webhook received: ${JSON.stringify(payload)}`);

    // Возвращаем true чтобы Cryptomus знал что мы получили
    return true;
  }

  /**
   * Верификация подписи Webhook.
   *
   * Cryptomus signs md5(base64(json_body_without_sign) + apiKey). The
   * signature arrives in the `sign` header and/or inside the body. We accept
   * either source, always strip `sign` from the payload before hashing, and
   * compare in constant time.
   */
  private verifySignature(
    payload: CryptomusWebhookPayload,
    signature: string,
    rawBody?: Buffer | string,
  ): boolean {
    const provided = signature || payload?.sign || '';
    if (!provided) return false;

    const { sign: _sign, ...unsigned } = payload ?? ({} as CryptomusWebhookPayload);

    // Candidate canonical bodies. Cryptomus (PHP) signs json_encode() output
    // with escaped slashes ("\/"), which differs from JSON.stringify. We try:
    // 1) the raw request body with the "sign" field stripped (closest to the
    //    exact bytes Cryptomus hashed), 2) JSON.stringify, 3) JSON.stringify
    //    with PHP-style escaped slashes.
    const candidates = new Set<string>();
    if (rawBody) {
      const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
      try {
        // Re-stringify from the raw body: preserves the original key order
        // (which ValidationPipe/whitelisting may have changed on `payload`).
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          delete parsed.sign;
          const s = JSON.stringify(parsed);
          candidates.add(s);
          candidates.add(s.replace(/\//g, '\\/'));
        }
      } catch {
        /* fall through to payload-based candidates */
      }
    }
    const stringified = JSON.stringify(unsigned);
    candidates.add(stringified);
    candidates.add(stringified.replace(/\//g, '\\/'));

    const b = Buffer.from(provided);
    for (const body of candidates) {
      const expected = crypto
        .createHash('md5')
        .update(Buffer.from(body).toString('base64') + this.apiKey)
        .digest('hex');
      const a = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    }
    return false;
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
