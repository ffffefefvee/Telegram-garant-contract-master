import { ConflictException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import {
  MULTICHAIN_DOMAIN_VERSION,
  QuoteVersion,
  TermsVersion,
  hashQuoteVersion,
} from "../escrow/adapters/multichain-domain-contract";
import { Deal } from "./entities/deal.entity";
import {
  SettlementConfirmationRecord,
  SettlementQuote,
} from "./entities/settlement-quote.entity";
import {
  DealStatus,
  FeeModel,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "./enums/deal.enum";
import { SettlementAgreementService } from "./settlement-agreement.service";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";
const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const SELLER_ID = "33333333-3333-4333-8333-333333333333";
const TERMS: TermsVersion = {
  domainVersion: MULTICHAIN_DOMAIN_VERSION,
  version: 3,
  hash: "a".repeat(64),
};

function versionedQuote(
  version = 1,
  overrides: Partial<Omit<QuoteVersion, "hash">> = {},
): QuoteVersion {
  const unsigned: Omit<QuoteVersion, "hash"> = {
    domainVersion: MULTICHAIN_DOMAIN_VERSION,
    quoteId:
      version === 1
        ? "44444444-4444-4444-8444-444444444444"
        : "55555555-5555-4555-8555-555555555555",
    version,
    termsVersion: TERMS.version,
    termsHash: TERMS.hash,
    feeModel: FeeModel.BUYER_PAYS,
    network: SettlementNetwork.POLYGON,
    chainId: "80002",
    asset: SettlementAsset.POLYGON_USDT,
    assetContract: `0x${"c".repeat(40)}`,
    decimals: 6,
    amountAtomic: "100000000",
    buyerFeeAtomic: "5000000",
    sellerFeeAtomic: "0",
    totalFundingAtomic: "105000000",
    sellerReceivesAtomic: "100000000",
    createdAt: `2099-01-01T0${version - 1}:00:00.000Z`,
    expiresAt: "2099-01-02T00:00:00.000Z",
    ...overrides,
  };
  return { ...unsigned, hash: hashQuoteVersion(unsigned) };
}

function deal(): Deal {
  return {
    id: DEAL_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    status: DealStatus.PENDING_ACCEPTANCE,
    paidAt: null,
    fundedAt: null,
    termsVersion: TERMS.version,
    termsHash: TERMS.hash,
    feeModel: FeeModel.BUYER_PAYS,
    settlementNetwork: SettlementNetwork.POLYGON,
    settlementChainId: "80002",
    settlementAsset: SettlementAsset.POLYGON_USDT,
    settlementMode: SettlementMode.NATIVE,
    assetContract: null,
    settlementQuoteId: null,
    settlementQuoteVersion: null,
    settlementQuoteHash: null,
  } as Deal;
}

describe("SettlementAgreementService", () => {
  let currentDeal: Deal;
  let quotes: SettlementQuote[];
  let confirmations: SettlementConfirmationRecord[];
  let service: SettlementAgreementService;

  beforeEach(() => {
    currentDeal = deal();
    quotes = [];
    confirmations = [];

    const dealRepository = {
      findOne: jest.fn(async () => currentDeal),
      save: jest.fn(async (value: Deal) => {
        currentDeal = value;
        return value;
      }),
    };
    const quoteRepository = {
      findOne: jest.fn(async (options: { where: Partial<SettlementQuote> }) => {
        const where = options.where;
        const matching = quotes.filter((record) =>
          Object.entries(where).every(
            ([key, value]) => record[key as keyof SettlementQuote] === value,
          ),
        );
        return matching.sort((a, b) => b.version - a.version)[0] ?? null;
      }),
      create: jest.fn((value: SettlementQuote) => value),
      save: jest.fn(async (value: SettlementQuote) => {
        const saved = { ...value, createdAt: new Date() } as SettlementQuote;
        quotes.push(saved);
        return saved;
      }),
    };
    const confirmationRepository = {
      findOne: jest.fn(
        async (options: { where: Partial<SettlementConfirmationRecord> }) =>
          confirmations.find((record) =>
            Object.entries(options.where).every(
              ([key, value]) =>
                record[key as keyof SettlementConfirmationRecord] === value,
            ),
          ) ?? null,
      ),
      find: jest.fn(
        async (options: { where: Partial<SettlementConfirmationRecord> }) =>
          confirmations.filter((record) =>
            Object.entries(options.where).every(
              ([key, value]) =>
                record[key as keyof SettlementConfirmationRecord] === value,
            ),
          ),
      ),
      create: jest.fn((value: SettlementConfirmationRecord) => value),
      save: jest.fn(async (value: SettlementConfirmationRecord) => {
        const saved = {
          ...value,
          id: `${confirmations.length + 6}6666666-6666-4666-8666-666666666666`.slice(
            0,
            36,
          ),
          confirmedAt: new Date("2099-01-01T00:30:00.000Z"),
        } as SettlementConfirmationRecord;
        confirmations.push(saved);
        return saved;
      }),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Deal) return dealRepository;
        if (entity === SettlementQuote) return quoteRepository;
        if (entity === SettlementConfirmationRecord)
          return confirmationRepository;
        throw new Error("Unexpected repository");
      }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (work: (manager: EntityManager) => unknown) =>
        work(manager),
      ),
    } as unknown as DataSource;
    service = new SettlementAgreementService(dataSource);
  });

  it("persists one immutable quote version and makes it authoritative", async () => {
    const quote = versionedQuote();
    const saved = await service.persistQuote({
      dealId: DEAL_ID,
      terms: TERMS,
      quote,
      now: new Date("2099-01-01T00:30:00.000Z"),
    });

    expect(saved.hash).toBe(quote.hash);
    expect(currentDeal).toMatchObject({
      settlementQuoteId: quote.quoteId,
      settlementQuoteVersion: 1,
      settlementQuoteHash: quote.hash,
      assetContract: quote.assetContract,
    });
  });

  it("requires monotonic quote versions", async () => {
    await expect(
      service.persistQuote({
        dealId: DEAL_ID,
        terms: TERMS,
        quote: versionedQuote(2),
        now: new Date("2099-01-01T00:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a quote whose fee model differs from the deal terms", async () => {
    await expect(
      service.persistQuote({
        dealId: DEAL_ID,
        terms: TERMS,
        quote: versionedQuote(1, { feeModel: FeeModel.SELLER_PAYS }),
        now: new Date("2099-01-01T00:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects quote replacement after funding", async () => {
    currentDeal.fundedAt = new Date();
    await expect(
      service.persistQuote({
        dealId: DEAL_ID,
        terms: TERMS,
        quote: versionedQuote(),
        now: new Date("2099-01-01T00:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("authorizes funding only after exact buyer and seller confirmations", async () => {
    const quote = versionedQuote();
    await service.persistQuote({
      dealId: DEAL_ID,
      terms: TERMS,
      quote,
      now: new Date("2099-01-01T00:30:00.000Z"),
    });
    const confirmation = {
      termsVersion: TERMS.version,
      termsHash: TERMS.hash,
      quoteId: quote.quoteId,
      quoteVersion: quote.version,
      quoteHash: quote.hash,
      network: quote.network,
      chainId: quote.chainId,
      asset: quote.asset,
    };
    await service.confirm({
      dealId: DEAL_ID,
      userId: BUYER_ID,
      confirmation,
    });
    await expect(
      service.assertFundingAuthorized(
        DEAL_ID,
        new Date("2099-01-01T00:31:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.confirm({
      dealId: DEAL_ID,
      userId: SELLER_ID,
      confirmation,
    });
    await expect(
      service.assertFundingAuthorized(
        DEAL_ID,
        new Date("2099-01-01T00:31:00.000Z"),
      ),
    ).resolves.toMatchObject({ hash: quote.hash, version: 1 });
  });

  it("rejects a stale confirmation after quote rotation", async () => {
    const first = versionedQuote();
    await service.persistQuote({
      dealId: DEAL_ID,
      terms: TERMS,
      quote: first,
      now: new Date("2099-01-01T00:30:00.000Z"),
    });
    const second = versionedQuote(2);
    await service.persistQuote({
      dealId: DEAL_ID,
      terms: TERMS,
      quote: second,
      now: new Date("2099-01-01T01:30:00.000Z"),
    });
    await expect(
      service.confirm({
        dealId: DEAL_ID,
        userId: BUYER_ID,
        confirmation: {
          termsVersion: TERMS.version,
          termsHash: TERMS.hash,
          quoteId: first.quoteId,
          quoteVersion: first.version,
          quoteHash: first.hash,
          network: first.network,
          chainId: first.chainId,
          asset: first.asset,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
