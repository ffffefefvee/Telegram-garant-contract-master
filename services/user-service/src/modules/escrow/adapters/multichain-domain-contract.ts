import { createHash } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  FeeModel,
  SettlementAsset,
  SettlementNetwork,
} from "../../deal/enums/deal.enum";

export const MULTICHAIN_DOMAIN_VERSION = 1 as const;

export type MultichainDomainVersion = typeof MULTICHAIN_DOMAIN_VERSION;

export enum NormalizedFundingStatus {
  UNAVAILABLE = "unavailable",
  AWAITING_FUNDING = "awaiting_funding",
  OBSERVED = "observed",
  PROVEN = "proven",
  FINALIZED = "finalized",
  EXPIRED = "expired",
  RECOVERY_REQUIRED = "recovery_required",
}

export enum NormalizedSettlementStatus {
  NOT_STARTED = "not_started",
  PENDING = "pending",
  RECOVERY_REQUIRED = "recovery_required",
  FINALIZED = "finalized",
}

export enum PayoutAvailability {
  UNAVAILABLE = "unavailable",
  LOCKED = "locked",
  ACTION_REQUIRED = "action_required",
  PROCESSING = "processing",
  RECOVERY_REQUIRED = "recovery_required",
  FINALIZED = "finalized",
}

export interface VersionedNetwork {
  domainVersion: MultichainDomainVersion;
  network: SettlementNetwork;
  chainId: string;
}

export interface VersionedAsset extends VersionedNetwork {
  asset: SettlementAsset;
  assetContract: string | null;
  decimals: number;
}

export interface TermsVersion {
  domainVersion: MultichainDomainVersion;
  version: number;
  hash: string;
}

export interface QuoteVersion extends VersionedAsset {
  quoteId: string;
  version: number;
  termsVersion: number;
  termsHash: string;
  feeModel: FeeModel;
  amountAtomic: string;
  buyerFeeAtomic: string;
  sellerFeeAtomic: string;
  totalFundingAtomic: string;
  sellerReceivesAtomic: string;
  createdAt: string;
  expiresAt: string;
  hash: string;
}

export interface ChainTransactionReference extends VersionedAsset {
  hash: string;
  blockNumber: string | null;
  blockHash: string | null;
  logicalTime: string | null;
}

export interface SettlementConfirmation {
  domainVersion: MultichainDomainVersion;
  party: "buyer" | "seller";
  userId: string;
  termsVersion: number;
  termsHash: string;
  quoteId: string;
  quoteVersion: number;
  quoteHash: string;
  network: SettlementNetwork;
  chainId: string;
  asset: SettlementAsset;
  confirmedAt: string;
}

export interface NormalizedFundingResult extends VersionedAsset {
  status: NormalizedFundingStatus;
  expectedAtomic: string;
  observedAtomic: string;
  finalized: boolean;
  transaction: ChainTransactionReference | null;
  evidenceHash: string | null;
  unavailableReason: string | null;
}

export interface NormalizedBalance extends VersionedAsset {
  available: boolean;
  balanceAtomic: string;
  finalized: boolean;
  observedAt: string;
  evidenceHash: string | null;
  unavailableReason: string | null;
}

export interface NormalizedReconciliationResult extends VersionedAsset {
  fundingStatus: NormalizedFundingStatus;
  settlementStatus: NormalizedSettlementStatus;
  payoutAvailability: PayoutAvailability;
  assetsAtomic: string;
  liabilitiesAtomic: string;
  deltaAtomic: string;
  finalized: boolean;
  primaryEvidenceHash: string | null;
  independentEvidenceHash: string | null;
  unavailableReason: string | null;
}

const ATOMIC = /^(0|[1-9][0-9]*)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hashQuoteVersion(quote: Omit<QuoteVersion, "hash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        domainVersion: quote.domainVersion,
        quoteId: quote.quoteId,
        version: quote.version,
        termsVersion: quote.termsVersion,
        termsHash: quote.termsHash,
        feeModel: quote.feeModel,
        network: quote.network,
        chainId: quote.chainId,
        asset: quote.asset,
        assetContract: quote.assetContract,
        decimals: quote.decimals,
        amountAtomic: quote.amountAtomic,
        buyerFeeAtomic: quote.buyerFeeAtomic,
        sellerFeeAtomic: quote.sellerFeeAtomic,
        totalFundingAtomic: quote.totalFundingAtomic,
        sellerReceivesAtomic: quote.sellerReceivesAtomic,
        createdAt: quote.createdAt,
        expiresAt: quote.expiresAt,
      }),
      "utf8",
    )
    .digest("hex");
}

export function assertValidTermsVersion(terms: TermsVersion): void {
  if (
    terms.domainVersion !== MULTICHAIN_DOMAIN_VERSION ||
    !Number.isSafeInteger(terms.version) ||
    terms.version < 1 ||
    !SHA256.test(terms.hash)
  ) {
    throw new BadRequestException("Invalid terms version");
  }
}

export function assertValidQuoteVersion(
  quote: QuoteVersion,
  terms: TermsVersion,
  now = new Date(),
  requireUnexpired = true,
): void {
  assertValidTermsVersion(terms);
  assertValidVersionedAsset(quote);

  const amounts = [
    quote.amountAtomic,
    quote.buyerFeeAtomic,
    quote.sellerFeeAtomic,
    quote.totalFundingAtomic,
    quote.sellerReceivesAtomic,
  ];
  if (
    quote.domainVersion !== MULTICHAIN_DOMAIN_VERSION ||
    !UUID.test(quote.quoteId) ||
    !Number.isSafeInteger(quote.version) ||
    quote.version < 1 ||
    quote.termsVersion !== terms.version ||
    quote.termsHash !== terms.hash ||
    !Object.values(FeeModel).includes(quote.feeModel) ||
    !Number.isSafeInteger(quote.decimals) ||
    quote.decimals < 0 ||
    quote.decimals > 18 ||
    amounts.some((amount) => !ATOMIC.test(amount)) ||
    !SHA256.test(quote.hash)
  ) {
    throw new BadRequestException("Invalid quote version");
  }

  const amount = BigInt(quote.amountAtomic);
  const buyerFee = BigInt(quote.buyerFeeAtomic);
  const sellerFee = BigInt(quote.sellerFeeAtomic);
  if (
    amount <= 0n ||
    sellerFee > amount ||
    BigInt(quote.totalFundingAtomic) !== amount + buyerFee ||
    BigInt(quote.sellerReceivesAtomic) !== amount - sellerFee
  ) {
    throw new BadRequestException("Quote conservation check failed");
  }

  const createdAt = Date.parse(quote.createdAt);
  const expiresAt = Date.parse(quote.expiresAt);
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= createdAt ||
    (requireUnexpired && expiresAt <= now.getTime())
  ) {
    throw new ConflictException("Quote is expired or has invalid timestamps");
  }

  const { hash: _hash, ...unsigned } = quote;
  if (hashQuoteVersion(unsigned) !== quote.hash) {
    throw new BadRequestException("Quote hash does not match its contents");
  }
}

export function assertBothPartiesConfirmed(input: {
  buyerId: string;
  sellerId: string;
  terms: TermsVersion;
  quote: QuoteVersion;
  confirmations: readonly SettlementConfirmation[];
  now?: Date;
  requireUnexpired?: boolean;
}): void {
  assertValidQuoteVersion(
    input.quote,
    input.terms,
    input.now,
    input.requireUnexpired ?? true,
  );
  if (!input.buyerId || !input.sellerId || input.buyerId === input.sellerId) {
    throw new BadRequestException("Settlement parties must be distinct");
  }

  const expected = new Map<"buyer" | "seller", string>([
    ["buyer", input.buyerId],
    ["seller", input.sellerId],
  ]);
  if (input.confirmations.length !== expected.size) {
    throw new ConflictException("Both parties must confirm the settlement");
  }

  const seen = new Set<string>();
  for (const confirmation of input.confirmations) {
    const expectedUserId = expected.get(confirmation.party);
    if (
      confirmation.domainVersion !== MULTICHAIN_DOMAIN_VERSION ||
      !expectedUserId ||
      confirmation.userId !== expectedUserId ||
      seen.has(confirmation.party) ||
      confirmation.termsVersion !== input.terms.version ||
      confirmation.termsHash !== input.terms.hash ||
      confirmation.quoteId !== input.quote.quoteId ||
      confirmation.quoteVersion !== input.quote.version ||
      confirmation.quoteHash !== input.quote.hash ||
      confirmation.network !== input.quote.network ||
      confirmation.chainId !== input.quote.chainId ||
      confirmation.asset !== input.quote.asset ||
      !Number.isFinite(Date.parse(confirmation.confirmedAt)) ||
      Date.parse(confirmation.confirmedAt) < Date.parse(input.quote.createdAt) ||
      Date.parse(confirmation.confirmedAt) > Date.parse(input.quote.expiresAt)
    ) {
      throw new ConflictException(
        "Settlement confirmation does not match the persisted terms and quote",
      );
    }
    seen.add(confirmation.party);
  }
}

export function assertNetworkAssetIdentity(
  value: Pick<VersionedAsset, "network" | "chainId" | "asset">,
): void {
  if (
    !value.chainId ||
    value.chainId !== value.chainId.trim() ||
    value.chainId.length > 64
  ) {
    throw new BadRequestException("Invalid settlement chainId");
  }
  const valid =
    (value.network === SettlementNetwork.TON &&
      (value.asset === SettlementAsset.TON_USDT ||
        value.asset === SettlementAsset.TON_NATIVE)) ||
    (value.network === SettlementNetwork.POLYGON &&
      value.asset === SettlementAsset.POLYGON_USDT);
  if (!valid) {
    throw new BadRequestException("Settlement network and asset do not match");
  }
}

export function assertValidVersionedAsset(value: VersionedAsset): void {
  assertNetworkAssetIdentity(value);
  if (
    value.domainVersion !== MULTICHAIN_DOMAIN_VERSION ||
    !Number.isSafeInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 18 ||
    (value.asset === SettlementAsset.TON_NATIVE
      ? value.assetContract !== null
      : !value.assetContract)
  ) {
    throw new BadRequestException("Invalid versioned settlement asset");
  }
}

export function assertSameSettlementIdentity(
  expected: Pick<VersionedAsset, "network" | "chainId" | "asset"> &
    Partial<Pick<VersionedAsset, "assetContract" | "decimals">>,
  actual: Pick<VersionedAsset, "network" | "chainId" | "asset"> &
    Partial<Pick<VersionedAsset, "assetContract" | "decimals">>,
): void {
  assertNetworkAssetIdentity(expected);
  assertNetworkAssetIdentity(actual);
  if (
    expected.network !== actual.network ||
    expected.chainId !== actual.chainId ||
    expected.asset !== actual.asset ||
    (expected.assetContract !== undefined &&
      expected.assetContract !== actual.assetContract) ||
    (expected.decimals !== undefined && expected.decimals !== actual.decimals)
  ) {
    throw new ConflictException(
      "Settlement network or asset changed across the money boundary",
    );
  }
}

export function assertValidChainTransactionReference(
  transaction: ChainTransactionReference,
  expected: Pick<VersionedAsset, "network" | "chainId" | "asset">,
): void {
  assertValidVersionedAsset(transaction);
  assertSameSettlementIdentity(expected, transaction);
  const validHash =
    transaction.network === SettlementNetwork.POLYGON
      ? /^0x[0-9a-fA-F]{64}$/.test(transaction.hash)
      : /^[0-9a-fA-F]{64}$/.test(transaction.hash);
  if (
    transaction.domainVersion !== MULTICHAIN_DOMAIN_VERSION ||
    !validHash ||
    !Number.isSafeInteger(transaction.decimals) ||
    transaction.decimals < 0 ||
    transaction.decimals > 18 ||
    (transaction.blockNumber !== null &&
      !ATOMIC.test(transaction.blockNumber)) ||
    (transaction.logicalTime !== null &&
      !ATOMIC.test(transaction.logicalTime)) ||
    (transaction.blockHash !== null &&
      !/^(0x)?[0-9a-fA-F]{64}$/.test(transaction.blockHash))
  ) {
    throw new BadRequestException("Invalid chain transaction reference");
  }
}
