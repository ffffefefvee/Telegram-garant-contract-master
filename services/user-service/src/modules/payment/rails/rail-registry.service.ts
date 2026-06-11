import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod } from '../enums/payment.enum';
import { PaymentRail } from './payment-rail.types';
import { CryptomusRail } from './cryptomus.rail';
import { DirectUsdtRail } from './direct-usdt.rail';
import { TonUsdtRail } from './ton-usdt.rail';

export interface RailDescriptor {
  method: PaymentMethod;
  label: string;
  available: boolean;
  /** Hosted checkout vs on-chain deposit — drives mini-app UI. */
  kind: 'hosted' | 'direct';
  /** Network the buyer pays on (direct rails), e.g. 'polygon' | 'ton'. */
  network?: string;
}

/**
 * Maps `PaymentMethod` → rail implementation.
 */
@Injectable()
export class RailRegistryService {
  private readonly rails: Map<PaymentMethod, PaymentRail>;

  constructor(
    cryptomusRail: CryptomusRail,
    directUsdtRail: DirectUsdtRail,
    tonUsdtRail: TonUsdtRail,
  ) {
    this.rails = new Map<PaymentMethod, PaymentRail>([
      [cryptomusRail.method, cryptomusRail],
      [directUsdtRail.method, directUsdtRail],
      [tonUsdtRail.method, tonUsdtRail],
    ]);
  }

  get(method: PaymentMethod): PaymentRail {
    const rail = this.rails.get(method);
    if (!rail) {
      throw new BadRequestException(`Unsupported payment method: ${method}`);
    }
    return rail;
  }

  has(method: PaymentMethod): boolean {
    return this.rails.has(method);
  }

  /**
   * Rail availability may require I/O (TON rail checks the relay float),
   * hence async. Unavailable rails are still listed with `available: false`
   * so the mini-app can explain *why* an option is missing if needed —
   * but it only renders `available: true` entries.
   */
  async list(): Promise<RailDescriptor[]> {
    return Promise.all(
      Array.from(this.rails.values()).map(async (rail) => ({
        method: rail.method,
        label: rail.label,
        available: await Promise.resolve(rail.isAvailable()),
        kind: rail.kind,
        network: this.networkOf(rail.method),
      })),
    );
  }

  private networkOf(method: PaymentMethod): string | undefined {
    switch (method) {
      case PaymentMethod.CRYPTO:
        return 'polygon';
      case PaymentMethod.CRYPTO_TON:
        return 'ton';
      default:
        return undefined;
    }
  }
}
