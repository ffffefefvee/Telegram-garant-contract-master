import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod } from '../enums/payment.enum';
import { PaymentRail } from './payment-rail.types';
import { CryptomusRail } from './cryptomus.rail';
import { DirectUsdtRail } from './direct-usdt.rail';

export interface RailDescriptor {
  method: PaymentMethod;
  label: string;
  available: boolean;
  /** Hosted checkout vs on-chain deposit — drives mini-app UI. */
  kind: 'hosted' | 'direct';
}

/**
 * Maps `PaymentMethod` → rail implementation. Stage 2 (TON) plugs in here
 * without touching `PaymentService`.
 */
@Injectable()
export class RailRegistryService {
  private readonly rails: Map<PaymentMethod, PaymentRail>;

  constructor(
    cryptomusRail: CryptomusRail,
    directUsdtRail: DirectUsdtRail,
  ) {
    this.rails = new Map<PaymentMethod, PaymentRail>([
      [cryptomusRail.method, cryptomusRail],
      [directUsdtRail.method, directUsdtRail],
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

  list(): RailDescriptor[] {
    return Array.from(this.rails.values()).map((rail) => ({
      method: rail.method,
      label: rail.label,
      available: rail.isAvailable(),
      kind: rail.method === PaymentMethod.CRYPTOMUS ? 'hosted' : 'direct',
    }));
  }
}
