import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import {
  MULTICHAIN_DOMAIN_VERSION,
  QuoteVersion,
  SettlementConfirmation,
  TermsVersion,
  assertBothPartiesConfirmed,
  assertSameSettlementIdentity,
  assertValidQuoteVersion,
} from "../escrow/adapters/multichain-domain-contract";
import { Deal } from "./entities/deal.entity";
import {
  SettlementConfirmationRecord,
  SettlementQuote,
} from "./entities/settlement-quote.entity";
import {
  DealStatus,
  SettlementAsset,
  SettlementNetwork,
} from "./enums/deal.enum";

export interface ConfirmSettlementInput {
  termsVersion: number;
  termsHash: string;
  quoteId: string;
  quoteVersion: number;
  quoteHash: string;
  network: SettlementNetwork;
  chainId: string;
  asset: SettlementAsset;
}

@Injectable()
export class SettlementAgreementService {
  constructor(private readonly dataSource: DataSource) {}

  async persistQuote(input: {
    dealId: string;
    terms: TermsVersion;
    quote: QuoteVersion;
    now?: Date;
  }): Promise<SettlementQuote> {
    const now = input.now ?? new Date();
    assertValidQuoteVersion(input.quote, input.terms, now);
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, input.dealId);
      this.assertQuoteCanBePersisted(deal, input.terms, input.quote);
      const quotes = manager.getRepository(SettlementQuote);
      const existing = await quotes.findOne({
        where: { id: input.quote.quoteId },
      });
      if (existing) {
        if (existing.dealId !== deal.id || existing.hash !== input.quote.hash) {
          throw new ConflictException(
            "Quote identifier already binds different contents",
          );
        }
        return existing;
      }

      const latest = await quotes.findOne({
        where: { dealId: deal.id },
        order: { version: "DESC" },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      if (input.quote.version !== nextVersion) {
        throw new ConflictException(
          `Next quote version must be ${nextVersion}`,
        );
      }

      const record = quotes.create({
        id: input.quote.quoteId,
        dealId: deal.id,
        domainVersion: input.quote.domainVersion,
        version: input.quote.version,
        termsVersion: input.quote.termsVersion,
        termsHash: input.quote.termsHash,
        feeModel: input.quote.feeModel,
        network: input.quote.network,
        chainId: input.quote.chainId,
        asset: input.quote.asset,
        assetContract: input.quote.assetContract,
        decimals: input.quote.decimals,
        amountAtomic: input.quote.amountAtomic,
        buyerFeeAtomic: input.quote.buyerFeeAtomic,
        sellerFeeAtomic: input.quote.sellerFeeAtomic,
        totalFundingAtomic: input.quote.totalFundingAtomic,
        sellerReceivesAtomic: input.quote.sellerReceivesAtomic,
        quotedAt: new Date(input.quote.createdAt),
        expiresAt: new Date(input.quote.expiresAt),
        hash: input.quote.hash,
      });
      const saved = await quotes.save(record);
      deal.settlementQuoteId = saved.id;
      deal.settlementQuoteVersion = saved.version;
      deal.settlementQuoteHash = saved.hash;
      deal.assetContract = saved.assetContract;
      await manager.getRepository(Deal).save(deal);
      return saved;
    });
  }

  async confirm(input: {
    dealId: string;
    userId: string;
    confirmation: ConfirmSettlementInput;
    now?: Date;
  }): Promise<SettlementConfirmationRecord> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, input.dealId);
      const party = this.partyFor(deal, input.userId);
      const quote = await this.currentQuote(manager, deal);
      assertValidQuoteVersion(
        this.quoteVersion(quote),
        this.terms(deal),
        input.now ?? new Date(),
      );
      this.assertConfirmationMatches(deal, quote, input.confirmation);
      const confirmations = manager.getRepository(SettlementConfirmationRecord);
      const existing = await confirmations.findOne({
        where: { quoteId: quote.id, party },
      });
      if (existing) {
        if (existing.userId !== input.userId) {
          throw new ConflictException(
            "Settlement party confirmation already exists",
          );
        }
        return existing;
      }
      return confirmations.save(
        confirmations.create({
          dealId: deal.id,
          quoteId: quote.id,
          party,
          userId: input.userId,
          domainVersion: MULTICHAIN_DOMAIN_VERSION,
          termsVersion: quote.termsVersion,
          termsHash: quote.termsHash,
          quoteVersion: quote.version,
          quoteHash: quote.hash,
          network: quote.network,
          chainId: quote.chainId,
          asset: quote.asset,
        }),
      );
    });
  }

  async assertFundingAuthorized(
    dealId: string,
    now = new Date(),
    requireUnexpired = true,
  ): Promise<QuoteVersion> {
    return this.dataSource.transaction(async (manager) => {
      const deal = await this.lockDeal(manager, dealId);
      const quote = await this.currentQuote(manager, deal);
      const terms = this.terms(deal);
      const versionedQuote = this.quoteVersion(quote);
      const confirmations = await manager
        .getRepository(SettlementConfirmationRecord)
        .find({
          where: { dealId: deal.id, quoteId: quote.id },
        });
      assertBothPartiesConfirmed({
        buyerId: deal.buyerId,
        sellerId: deal.sellerId ?? "",
        terms,
        quote: versionedQuote,
        confirmations: confirmations.map((record) => this.confirmation(record)),
        now,
        requireUnexpired,
      });
      return versionedQuote;
    });
  }

  private async lockDeal(
    manager: EntityManager,
    dealId: string,
  ): Promise<Deal> {
    const deal = await manager.getRepository(Deal).findOne({
      where: { id: dealId },
      lock: { mode: "pessimistic_write" },
    });
    if (!deal) throw new NotFoundException("Deal not found");
    return deal;
  }

  private assertQuoteCanBePersisted(
    deal: Deal,
    terms: TermsVersion,
    quote: QuoteVersion,
  ): void {
    if (
      deal.paidAt ||
      deal.fundedAt ||
      ![
        DealStatus.DRAFT,
        DealStatus.PENDING_ACCEPTANCE,
        DealStatus.PENDING_PAYMENT,
      ].includes(deal.status)
    ) {
      throw new ConflictException(
        "Settlement quote cannot change after funding",
      );
    }
    if (!deal.sellerId) {
      throw new ConflictException(
        "Both settlement parties are required before quoting",
      );
    }
    if (
      deal.termsVersion !== terms.version ||
      deal.termsHash !== terms.hash ||
      deal.feeModel !== quote.feeModel ||
      !deal.settlementNetwork ||
      !deal.settlementChainId ||
      !deal.settlementAsset
    ) {
      throw new ConflictException(
        "Deal terms are not ready for settlement quoting",
      );
    }
    assertSameSettlementIdentity(
      {
        network: deal.settlementNetwork,
        chainId: deal.settlementChainId,
        asset: deal.settlementAsset,
      },
      quote,
    );
    if (deal.assetContract && deal.assetContract !== quote.assetContract) {
      throw new ConflictException("Quote asset contract changed");
    }
  }

  private async currentQuote(
    manager: EntityManager,
    deal: Deal,
  ): Promise<SettlementQuote> {
    if (
      !deal.settlementQuoteId ||
      !deal.settlementQuoteVersion ||
      !deal.settlementQuoteHash
    ) {
      throw new ConflictException("Authoritative settlement quote is missing");
    }
    const quote = await manager.getRepository(SettlementQuote).findOne({
      where: {
        id: deal.settlementQuoteId,
        dealId: deal.id,
        version: deal.settlementQuoteVersion,
        hash: deal.settlementQuoteHash,
      },
      lock: { mode: "pessimistic_read" },
    });
    if (!quote)
      throw new ConflictException("Settlement quote pointer is invalid");
    return quote;
  }

  private partyFor(deal: Deal, userId: string): "buyer" | "seller" {
    if (userId === deal.buyerId) return "buyer";
    if (userId === deal.sellerId) return "seller";
    throw new BadRequestException(
      "Only a settlement party can confirm the quote",
    );
  }

  private assertConfirmationMatches(
    deal: Deal,
    quote: SettlementQuote,
    confirmation: ConfirmSettlementInput,
  ): void {
    if (
      confirmation.termsVersion !== deal.termsVersion ||
      confirmation.termsHash !== deal.termsHash ||
      confirmation.quoteId !== quote.id ||
      confirmation.quoteVersion !== quote.version ||
      confirmation.quoteHash !== quote.hash ||
      confirmation.network !== quote.network ||
      confirmation.chainId !== quote.chainId ||
      confirmation.asset !== quote.asset
    ) {
      throw new ConflictException(
        "Confirmation does not match the authoritative terms and quote",
      );
    }
  }

  private terms(deal: Deal): TermsVersion {
    if (!deal.termsHash) {
      throw new ConflictException("Deal terms hash is missing");
    }
    return {
      domainVersion: MULTICHAIN_DOMAIN_VERSION,
      version: deal.termsVersion,
      hash: deal.termsHash,
    };
  }

  private quoteVersion(record: SettlementQuote): QuoteVersion {
    return {
      domainVersion: MULTICHAIN_DOMAIN_VERSION,
      quoteId: record.id,
      version: record.version,
      termsVersion: record.termsVersion,
      termsHash: record.termsHash,
      feeModel: record.feeModel,
      network: record.network,
      chainId: record.chainId,
      asset: record.asset,
      assetContract: record.assetContract,
      decimals: record.decimals,
      amountAtomic: record.amountAtomic,
      buyerFeeAtomic: record.buyerFeeAtomic,
      sellerFeeAtomic: record.sellerFeeAtomic,
      totalFundingAtomic: record.totalFundingAtomic,
      sellerReceivesAtomic: record.sellerReceivesAtomic,
      createdAt: record.quotedAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      hash: record.hash,
    };
  }

  private confirmation(
    record: SettlementConfirmationRecord,
  ): SettlementConfirmation {
    return {
      domainVersion: MULTICHAIN_DOMAIN_VERSION,
      party: record.party,
      userId: record.userId,
      termsVersion: record.termsVersion,
      termsHash: record.termsHash,
      quoteId: record.quoteId,
      quoteVersion: record.quoteVersion,
      quoteHash: record.quoteHash,
      network: record.network,
      chainId: record.chainId,
      asset: record.asset,
      confirmedAt: record.confirmedAt.toISOString(),
    };
  }
}
