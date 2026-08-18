import { BadRequestException } from "@nestjs/common";
import { Deal } from "../deal/entities/deal.entity";
import {
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "../deal/enums/deal.enum";
import { PaymentMethod } from "./enums/payment.enum";
import { assertPaymentMethodMatchesDeal } from "./settlement-payment-policy";

function dealWith(
  network: SettlementNetwork | null,
  asset: SettlementAsset | null,
  mode: SettlementMode | null,
): Deal {
  return {
    settlementNetwork: network,
    settlementAsset: asset,
    settlementMode: mode,
  } as Deal;
}

describe("payment settlement policy", () => {
  it("allows direct Polygon USDT for a native Polygon deal", () => {
    expect(() =>
      assertPaymentMethodMatchesDeal(
        dealWith(
          SettlementNetwork.POLYGON,
          SettlementAsset.POLYGON_USDT,
          SettlementMode.NATIVE,
        ),
        PaymentMethod.CRYPTO,
      ),
    ).not.toThrow();
  });

  it("blocks the legacy TON-to-Polygon rail for a native TON deal", () => {
    expect(() =>
      assertPaymentMethodMatchesDeal(
        dealWith(
          SettlementNetwork.TON,
          SettlementAsset.TON_USDT,
          SettlementMode.NATIVE,
        ),
        PaymentMethod.CRYPTO_TON,
      ),
    ).toThrow(BadRequestException);
  });

  it("allows the TON rail only for explicitly classified historical hybrid deals", () => {
    expect(() =>
      assertPaymentMethodMatchesDeal(
        dealWith(
          SettlementNetwork.POLYGON,
          SettlementAsset.POLYGON_USDT,
          SettlementMode.LEGACY_TON_TO_POLYGON,
        ),
        PaymentMethod.CRYPTO_TON,
      ),
    ).not.toThrow();
  });

  it("preserves untyped historical deal behavior", () => {
    expect(() =>
      assertPaymentMethodMatchesDeal(
        dealWith(null, null, null),
        PaymentMethod.CRYPTOMUS,
      ),
    ).not.toThrow();
  });
});
