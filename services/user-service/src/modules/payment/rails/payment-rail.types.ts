import { Payment } from '../entities/payment.entity';
import { PaymentMethod } from '../enums/payment.enum';

/**
 * A payment rail is one way for a buyer to fund a deal. It must declare its
 * real funding and settlement behavior; settlement is never inferred from a
 * marketing label or silently bridged across chains.
 *
 *  - CRYPTOMUS    — hosted checkout → relay hot-wallet → forwardAndFund()
 *  - DIRECT_USDT  — buyer sends USDT (Polygon) straight to the escrow clone
 *                   address → watcher confirms → notifyFunded() (no custody)
 *  - TON legacy   — historical USDT-TON/TON ingress backed by Polygon float;
 *                   never offered for new native TON settlement deals
 */
export interface RailInvoice {
  /** Hosted checkout URL (gateway rails). */
  paymentUrl?: string;
  /** On-chain deposit address (direct rails). */
  depositAddress?: string;
  /**
   * Escrow backing this payment. Historical hybrid rails may differ from the
   * funding address and are explicitly classified as legacy.
   */
  escrowAddress?: string;
  /** Transfer comment the buyer MUST attach (TON rail). */
  memo?: string;
  /** Network the buyer must use, e.g. 'polygon'. */
  network?: string;
  /** Asset the buyer must send, e.g. 'USDT'. */
  asset?: string;
  /**
   * Exact human-readable amount the buyer must transfer
   * (deal amount + buyer fee), e.g. "105.5".
   */
  requiredAmount?: string;
  expiresAt: Date;
  /** Rail-specific extras persisted into payment.metadata. */
  metadata?: Record<string, unknown>;
}

export interface RailInvoiceContext {
  dealId: string;
  userId: string;
  /** Deal amount in the deal's currency (USDT for direct rails). */
  amount: number;
  currency: string;
  description: string;
  orderId: string;
}

export interface RailStatusResult {
  /** True when the payment reached a final paid state during this check. */
  completed: boolean;
  /** Optional tx hash that proves funding. */
  txId?: string;
  /** Funded amount in USDT (if known). */
  fundedUsdt?: number;
  /** Partial funding received so far in USDT (direct rails). */
  receivedUsdt?: number;
  /** Required total in USDT (direct rails). */
  requiredUsdt?: number;
  /** True when the invoice can no longer be paid (deadline passed). */
  expired?: boolean;
}

export interface PaymentRail {
  readonly method: PaymentMethod;
  /** Human label for UI listings. */
  readonly label: string;
  /** Hosted checkout vs on-chain deposit — drives mini-app UI. */
  readonly kind: 'hosted' | 'direct';
  /** Is this rail currently usable (config/chain/float availability)? */
  isAvailable(): boolean | Promise<boolean>;
  /** Create rail-specific invoice data for a new payment. */
  createInvoice(ctx: RailInvoiceContext): Promise<RailInvoice>;
  /**
   * Actively check payment progress (user-triggered or watcher-triggered).
   * Implementations must be idempotent.
   */
  checkStatus(payment: Payment): Promise<RailStatusResult>;
}
