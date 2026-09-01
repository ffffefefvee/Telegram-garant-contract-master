import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../../deal/enums/deal.enum";
import {
  assertBothPartiesConfirmed,
  assertSameSettlementIdentity,
  assertValidQuoteVersion,
  hashQuoteVersion,
  MULTICHAIN_DOMAIN_VERSION,
  QuoteVersion,
  SettlementConfirmation,
  TermsVersion,
} from "./multichain-domain-contract";

const TERMS: TermsVersion = {
  domainVersion: MULTICHAIN_DOMAIN_VERSION,
  version: 3,
  hash: "a".repeat(64),
};

function quote(overrides: Partial<QuoteVersion> = {}): QuoteVersion {
  const unsigned: Omit<QuoteVersion, "hash"> = {
    domainVersion: MULTICHAIN_DOMAIN_VERSION,
    quoteId: "11111111-1111-4111-8111-111111111111",
    version: 2,
    termsVersion: TERMS.version,
    termsHash: TERMS.hash,
    feeModel: FeeModel.BUYER_PAYS,
    network: SettlementNetwork.TON,
    chainId: "testnet",
    asset: SettlementAsset.TON_USDT,
    assetContract:
      "0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    decimals: 6,
    amountAtomic: "100000000",
    buyerFeeAtomic: "5000000",
    sellerFeeAtomic: "0",
    totalFundingAtomic: "105000000",
    sellerReceivesAtomic: "100000000",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-01T01:00:00.000Z",
    ...overrides,
  };
  return { ...unsigned, hash: hashQuoteVersion(unsigned) };
}

function confirmation(
  party: "buyer" | "seller",
  value: QuoteVersion,
  overrides: Partial<SettlementConfirmation> = {},
): SettlementConfirmation {
  return {
    domainVersion: MULTICHAIN_DOMAIN_VERSION,
    party,
    userId: party === "buyer" ? "buyer-1" : "seller-1",
    termsVersion: TERMS.version,
    termsHash: TERMS.hash,
    quoteId: value.quoteId,
    quoteVersion: value.version,
    quoteHash: value.hash,
    network: value.network,
    chainId: value.chainId,
    asset: value.asset,
    confirmedAt: "2026-09-01T00:05:00.000Z",
    ...overrides,
  };
}

describe("multichain domain contract", () => {
  const beforeExpiry = new Date("2026-09-01T00:30:00.000Z");

  it("accepts a hash-bound, conserved, unexpired persisted quote", () => {
    expect(() =>
      assertValidQuoteVersion(quote(), TERMS, beforeExpiry),
    ).not.toThrow();
  });

  it.each([
    ["amountAtomic", "01"],
    ["buyerFeeAtomic", "-1"],
    ["sellerFeeAtomic", "1.5"],
    ["totalFundingAtomic", "105000001"],
    ["sellerReceivesAtomic", "99999999"],
  ] as const)("rejects invalid or unconserved %s", (field, value) => {
    expect(() =>
      assertValidQuoteVersion(quote({ [field]: value }), TERMS, beforeExpiry),
    ).toThrow(BadRequestException);
  });

  it("rejects an expired quote", () => {
    expect(() =>
      assertValidQuoteVersion(
        quote(),
        TERMS,
        new Date("2026-09-01T01:00:00.000Z"),
      ),
    ).toThrow(ConflictException);
  });

  it("rejects any quote-content change after the hash was persisted", () => {
    const persisted = quote();
    const changed = { ...persisted, amountAtomic: "100000001" };
    expect(() => assertValidQuoteVersion(changed, TERMS, beforeExpiry)).toThrow(
      BadRequestException,
    );
  });

  it("rejects a token quote without an exact asset contract/master", () => {
    expect(() =>
      assertValidQuoteVersion(
        quote({ assetContract: null }),
        TERMS,
        beforeExpiry,
      ),
    ).toThrow(BadRequestException);
  });

  it("requires exact buyer and seller confirmations of one quote", () => {
    const persisted = quote();
    expect(() =>
      assertBothPartiesConfirmed({
        buyerId: "buyer-1",
        sellerId: "seller-1",
        terms: TERMS,
        quote: persisted,
        confirmations: [
          confirmation("buyer", persisted),
          confirmation("seller", persisted),
        ],
        now: beforeExpiry,
      }),
    ).not.toThrow();
  });

  it("rejects a confirmation recorded after quote expiry", () => {
    const persisted = quote();
    expect(() =>
      assertBothPartiesConfirmed({
        buyerId: "buyer-1",
        sellerId: "seller-1",
        terms: TERMS,
        quote: persisted,
        confirmations: [
          confirmation("buyer", persisted),
          confirmation("seller", persisted, {
            confirmedAt: "2026-09-01T01:00:00.001Z",
          }),
        ],
        now: beforeExpiry,
      }),
    ).toThrow(ConflictException);
  });

  it.each([
    ["missing seller", (value: QuoteVersion) => [confirmation("buyer", value)]],
    [
      "duplicate buyer",
      (value: QuoteVersion) => [
        confirmation("buyer", value),
        confirmation("buyer", value),
      ],
    ],
    [
      "stale quote hash",
      (value: QuoteVersion) => [
        confirmation("buyer", value),
        confirmation("seller", value, { quoteHash: "b".repeat(64) }),
      ],
    ],
    [
      "cross-chain substitution",
      (value: QuoteVersion) => [
        confirmation("buyer", value),
        confirmation("seller", value, { chainId: "mainnet" }),
      ],
    ],
  ])("rejects %s confirmation evidence", (_name, makeConfirmations) => {
    const persisted = quote();
    expect(() =>
      assertBothPartiesConfirmed({
        buyerId: "buyer-1",
        sellerId: "seller-1",
        terms: TERMS,
        quote: persisted,
        confirmations: makeConfirmations(persisted),
        now: beforeExpiry,
      }),
    ).toThrow(ConflictException);
  });

  it("keeps TON and Polygon settlement identities independent", () => {
    expect(() =>
      assertSameSettlementIdentity(
        {
          network: SettlementNetwork.TON,
          chainId: "testnet",
          asset: SettlementAsset.TON_USDT,
        },
        {
          network: SettlementNetwork.POLYGON,
          chainId: "80002",
          asset: SettlementAsset.POLYGON_USDT,
        },
      ),
    ).toThrow(ConflictException);
  });

  it("rejects an asset that does not belong to its network", () => {
    expect(() =>
      assertSameSettlementIdentity(
        {
          network: SettlementNetwork.TON,
          chainId: "testnet",
          asset: SettlementAsset.POLYGON_USDT,
        },
        {
          network: SettlementNetwork.TON,
          chainId: "testnet",
          asset: SettlementAsset.POLYGON_USDT,
        },
      ),
    ).toThrow(BadRequestException);
  });
});
