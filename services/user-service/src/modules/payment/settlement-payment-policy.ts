import { BadRequestException } from "@nestjs/common";
import {
  ClientChannel,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "../deal/enums/deal.enum";
import { Deal } from "../deal/entities/deal.entity";
import { PaymentMethod } from "./enums/payment.enum";

export interface PaymentRouteProfile {
  fundingNetwork?: SettlementNetwork;
  settlementNetwork: SettlementNetwork;
  settlementAsset: SettlementAsset;
  settlementMode: SettlementMode;
  channels: ClientChannel[];
}

/** Describes current behavior truthfully; it does not enable new routes. */
export const PAYMENT_ROUTE_PROFILES: Record<
  PaymentMethod,
  PaymentRouteProfile | null
> = {
  [PaymentMethod.CRYPTOMUS]: {
    settlementNetwork: SettlementNetwork.POLYGON,
    settlementAsset: SettlementAsset.POLYGON_USDT,
    settlementMode: SettlementMode.NATIVE,
    channels: [ClientChannel.WEB],
  },
  [PaymentMethod.CRYPTO]: {
    fundingNetwork: SettlementNetwork.POLYGON,
    settlementNetwork: SettlementNetwork.POLYGON,
    settlementAsset: SettlementAsset.POLYGON_USDT,
    settlementMode: SettlementMode.NATIVE,
    channels: [ClientChannel.WEB],
  },
  [PaymentMethod.CRYPTO_TON]: {
    fundingNetwork: SettlementNetwork.TON,
    settlementNetwork: SettlementNetwork.POLYGON,
    settlementAsset: SettlementAsset.POLYGON_USDT,
    settlementMode: SettlementMode.LEGACY_TON_TO_POLYGON,
    channels: [],
  },
  [PaymentMethod.CRYPTO_TONCOIN]: {
    fundingNetwork: SettlementNetwork.TON,
    settlementNetwork: SettlementNetwork.POLYGON,
    settlementAsset: SettlementAsset.POLYGON_USDT,
    settlementMode: SettlementMode.LEGACY_TON_TO_POLYGON,
    channels: [],
  },
  [PaymentMethod.CARD]: null,
  [PaymentMethod.E_WALLET]: null,
  [PaymentMethod.BALANCE]: null,
};

/**
 * New typed deals may only use a rail whose real settlement behavior matches
 * their immutable terms. Untyped historical deals retain legacy behavior.
 */
export function assertPaymentMethodMatchesDeal(
  deal: Deal,
  method: PaymentMethod,
): void {
  if (
    !deal.settlementNetwork ||
    !deal.settlementAsset ||
    !deal.settlementMode
  ) {
    return;
  }

  const profile = PAYMENT_ROUTE_PROFILES[method];
  if (!profile) {
    throw new BadRequestException(`Payment method ${method} is not configured`);
  }

  if (
    profile.settlementNetwork !== deal.settlementNetwork ||
    profile.settlementAsset !== deal.settlementAsset ||
    profile.settlementMode !== deal.settlementMode
  ) {
    if (
      deal.settlementNetwork === SettlementNetwork.TON &&
      deal.settlementMode === SettlementMode.NATIVE
    ) {
      throw new BadRequestException(
        "Native TON settlement is not enabled yet; the legacy TON-to-Polygon rail cannot fund this deal",
      );
    }
    throw new BadRequestException(
      `Payment method ${method} does not match the deal settlement terms`,
    );
  }
}
