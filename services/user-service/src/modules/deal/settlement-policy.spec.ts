import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  ClientChannel,
  DealStatus,
  SettlementAsset,
  SettlementNetwork,
} from "./enums/deal.enum";
import {
  assertSettlementCanChange,
  settlementSelectionChanged,
  validateSettlementSelection,
} from "./settlement-policy";

describe("settlement policy", () => {
  it("allows TON in Telegram Mini App", () => {
    expect(
      validateSettlementSelection(
        {
          network: SettlementNetwork.TON,
          chainId: "mainnet",
          asset: SettlementAsset.TON_USDT,
        },
        ClientChannel.TELEGRAM_MINI_APP,
      ),
    ).toEqual({
      network: SettlementNetwork.TON,
      chainId: "mainnet",
      asset: SettlementAsset.TON_USDT,
    });
  });

  it("rejects Polygon in Telegram Mini App", () => {
    expect(() =>
      validateSettlementSelection(
        {
          network: SettlementNetwork.POLYGON,
          chainId: "137",
          asset: SettlementAsset.POLYGON_USDT,
        },
        ClientChannel.TELEGRAM_MINI_APP,
      ),
    ).toThrow(BadRequestException);
  });

  it("allows Polygon on the website", () => {
    expect(() =>
      validateSettlementSelection(
        {
          network: SettlementNetwork.POLYGON,
          chainId: "137",
          asset: SettlementAsset.POLYGON_USDT,
        },
        ClientChannel.WEB,
      ),
    ).not.toThrow();
  });

  it("rejects an asset from another network", () => {
    expect(() =>
      validateSettlementSelection(
        {
          network: SettlementNetwork.TON,
          chainId: "mainnet",
          asset: SettlementAsset.POLYGON_USDT,
        },
        ClientChannel.WEB,
      ),
    ).toThrow(BadRequestException);
  });

  it("detects a change in network, chain or asset", () => {
    expect(
      settlementSelectionChanged(
        {
          network: SettlementNetwork.TON,
          chainId: "mainnet",
          asset: SettlementAsset.TON_USDT,
        },
        {
          network: SettlementNetwork.POLYGON,
          chainId: "137",
          asset: SettlementAsset.POLYGON_USDT,
        },
      ),
    ).toBe(true);
  });

  it("locks settlement once funding is recorded", () => {
    expect(() =>
      assertSettlementCanChange({
        status: DealStatus.PENDING_PAYMENT,
        paidAt: new Date(),
      }),
    ).toThrow(ConflictException);
  });
});
