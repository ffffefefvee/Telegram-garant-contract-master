import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod } from '../enums/payment.enum';
import { PaymentRail } from './payment-rail.types';
import { CryptomusRail } from './cryptomus.rail';
import { DirectUsdtRail } from './direct-usdt.rail';
import { TonUsdtRail } from './ton-usdt.rail';
import { ToncoinRail } from './toncoin.rail';
import {
  ClientChannel,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from '../../deal/enums/deal.enum';
import { PAYMENT_ROUTE_PROFILES } from '../settlement-payment-policy';

export interface RailDescriptor {
  method: PaymentMethod;
  label: string;
  available: boolean;
  /** Hosted checkout vs on-chain deposit — drives mini-app UI. */
  kind: 'hosted' | 'direct';
  /** Network the buyer pays on (direct rails), e.g. 'polygon' | 'ton'. */
  network?: string;
  /** Actual settlement behavior, including legacy hybrid routes. */
  settlementNetwork?: SettlementNetwork;
  settlementAsset?: SettlementAsset;
  settlementMode?: SettlementMode;
  channels: ClientChannel[];
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
    toncoinRail: ToncoinRail,
  ) {
    this.rails = new Map<PaymentMethod, PaymentRail>([
      [cryptomusRail.method, cryptomusRail],
      [directUsdtRail.method, directUsdtRail],
      [tonUsdtRail.method, tonUsdtRail],
      [toncoinRail.method, toncoinRail],
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
      Array.from(this.rails.values()).map(async (rail) => {
        const profile = PAYMENT_ROUTE_PROFILES[rail.method];
        return {
          method: rail.method,
          label: rail.label,
          available: await Promise.resolve(rail.isAvailable()),
          kind: rail.kind,
          network: this.networkOf(rail.method),
          settlementNetwork: profile?.settlementNetwork,
          settlementAsset: profile?.settlementAsset,
          settlementMode: profile?.settlementMode,
          channels: profile?.channels ?? [],
        };
      }),
    );
  }

  private networkOf(method: PaymentMethod): string | undefined {
    switch (method) {
      case PaymentMethod.CRYPTO:
        return 'polygon';
      case PaymentMethod.CRYPTO_TON:
      case PaymentMethod.CRYPTO_TONCOIN:
        return 'ton';
      default:
        return undefined;
    }
  }
}
