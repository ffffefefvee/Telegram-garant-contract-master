import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { WebhookRateLimitGuard } from './webhook-rate-limit.guard';
import { CryptomusService, CryptomusWebhookPayload } from './cryptomus.service';
import { PaymentWebhookService } from './payment-webhook.service';

/**
 * Cryptomus calls this endpoint on every payment status change. The body
 * arrives as JSON; the `sign` header is an MD5(base64(JSON) || apiKey) HMAC
 * which we verify with `CryptomusService.handleWebhook`.
 *
 * Cryptomus expects `{ state: 0 }` for success and `{ state: 1 }` for any
 * error it should retry. We return `state: 0` for everything that we
 * accepted and recorded — even partials (e.g. wallets not yet attached) —
 * because returning 1 causes Cryptomus to retry forever and the partial
 * cases are handled by reconciliation (PR 6/6), not by the webhook retry.
 *
 * Mounted at `/api/webhook/cryptomus`. Excluded from `RequireAuthMiddleware`
 * (see AuthModule).
 */
// Excluded from the global ThrottlerGuard: Cryptomus retries can burst and
// the endpoint already has a dedicated WebhookRateLimitGuard keyed off the
// merchant signature.
@SkipThrottle()
@Controller('webhook/cryptomus')
@UseGuards(WebhookRateLimitGuard)
export class CryptomusWebhookController {
  private readonly logger = new Logger(CryptomusWebhookController.name);

  constructor(
    private readonly cryptomusService: CryptomusService,
    private readonly paymentWebhook: PaymentWebhookService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: CryptomusWebhookPayload,
    @Headers('sign') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ state: number; processed?: object }> {
    this.logger.log(
      `Webhook received: order=${payload?.order_id} status=${payload?.status}`,
    );

    const isValid = await this.cryptomusService.handleWebhook(
      payload,
      signature,
      req.rawBody,
    );
    if (!isValid) {
      this.logger.error(`Invalid webhook signature for order=${payload?.order_id}`);
      // state=1 tells Cryptomus we did NOT accept the call. They retry.
      return { state: 1 };
    }

    try {
      const result = await this.paymentWebhook.handlePaymentWebhook(payload);
      return { state: 0, processed: result };
    } catch (err) {
      // Anything thrown here is genuinely unexpected (invariant breach, DB
      // outage). Cryptomus retries on state=1, which is the right behaviour.
      this.logger.error(
        `Webhook processing error for order=${payload?.order_id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return { state: 1 };
    }
  }
}
