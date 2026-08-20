import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager, FindOneOptions } from "typeorm";
import { Address } from "@ton/ton";
import { Deal } from "./entities/deal.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import {
  Currency,
  DealStatus,
  FeeModel,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "./enums/deal.enum";
import {
  TonNetwork,
  TonWalletBinding,
} from "../user/entities/ton-wallet-binding.entity";
import { TonEscrowAdapter } from "../escrow/adapters/ton-escrow.adapter";
import { TonNativeEscrowComposer } from "../escrow/adapters/ton-native-escrow-composer";
import {
  buildTonConnectTransactionRequest,
  TonConnectTransactionRequest,
} from "../blockchain/ton-connect-transaction";

const HASH_256 = /^[0-9a-f]{64}$/;

export interface TonNativeFundingResponse {
  quoteId: string;
  quoteHash: string;
  termsHash: string;
  codeHash: string;
  configHash: string;
  escrowAddress: string;
  buyerTotalAtomic: string;
  sellerPayoutAtomic: string;
  platformFeeAtomic: string;
  refundToBuyerAtomic: string;
  refundFeeAtomic: string;
  operationalReserveAtomic: string;
  fundingDeadline: number;
  deliveryDeadline: number;
  confirmationDeadline: number;
  transaction: TonConnectTransactionRequest;
}

interface NativeTonEconomics {
  buyerTotal: bigint;
  sellerPayout: bigint;
  platformFee: bigint;
}

@Injectable()
export class TonNativeFundingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly adapter: TonEscrowAdapter,
    private readonly composer: TonNativeEscrowComposer,
  ) {}

  async buildFundingRequest(
    dealId: string,
    buyerId: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<TonNativeFundingResponse> {
    // This remains false until finalized ingestion and reconciliation are
    // implemented. The complete code path can be tested without exposing a
    // sendable request to a real user prematurely.
    if (!this.adapter.isReady()) {
      throw new ServiceUnavailableException(
        "Native TON funding is not enabled yet",
      );
    }
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new BadRequestException("Invalid funding request time");
    }

    const settings = this.getSettings();
    const preparation = await this.dataSource.transaction((manager) =>
      this.loadOrCreatePreparation(
        manager,
        dealId,
        buyerId,
        nowSeconds,
        settings,
      ),
    );

    return this.toResponse(preparation, nowSeconds, settings.transactionTtl);
  }

  private async loadOrCreatePreparation(
    manager: EntityManager,
    dealId: string,
    buyerId: string,
    nowSeconds: number,
    settings: NativeTonSettings,
  ): Promise<TonNativeEscrowPreparation> {
    const findOptions: FindOneOptions<Deal> = {
      where: { id: dealId },
    };
    if (this.dataSource.options.type === "postgres") {
      Object.assign(findOptions, { lock: { mode: "pessimistic_write" } });
    }
    const deal = await manager.findOne(Deal, findOptions);
    if (!deal) throw new NotFoundException("Deal not found");
    this.assertDealCanBeFunded(deal, buyerId, settings.network);

    const buyerBinding = await manager.findOne(TonWalletBinding, {
      where: { userId: deal.buyerId, network: settings.network },
    });
    const sellerBinding = await manager.findOne(TonWalletBinding, {
      where: { userId: deal.sellerId!, network: settings.network },
    });
    if (!buyerBinding || !sellerBinding) {
      throw new ConflictException(
        "Both parties must verify a TON wallet before funding",
      );
    }

    const current = await manager.findOne(TonNativeEscrowPreparation, {
      where: { dealId },
    });
    if (current) {
      this.assertPreparationStillMatches(
        current,
        deal,
        buyerBinding,
        sellerBinding,
        settings,
        nowSeconds,
      );
      return current;
    }
    if (deal.quoteId || deal.escrowAddress) {
      throw new ConflictException(
        "Deal already references a different settlement preparation",
      );
    }

    const deliveryDeadline = toUnixSeconds(deal.deadline);
    const fundingDeadline = nowSeconds + settings.fundingWindow;
    const confirmationDeadline = deliveryDeadline + settings.confirmationWindow;
    if (fundingDeadline >= deliveryDeadline) {
      throw new ConflictException(
        "Deal delivery deadline is too close to fund safely",
      );
    }

    const economics = computeNativeTonEconomics(
      deal.amount,
      deal.commissionAmount,
      deal.feeModel,
    );
    if (settings.refundFee > economics.buyerTotal) {
      throw new ServiceUnavailableException(
        "Configured TON refund fee exceeds the buyer total",
      );
    }
    const refundToBuyer = economics.buyerTotal - settings.refundFee;
    const termsHash = deal.termsHash!.toLowerCase();
    const quoteId = randomUUID();
    const artifact = this.adapter.nativeArtifact;
    if (!artifact.verified || !artifact.codeHash) {
      throw new ServiceUnavailableException(
        "Approved native TON artifact is unavailable",
      );
    }

    const quoteHash = hashNativeTonQuote({
      quoteId,
      dealId,
      chainId: deal.settlementChainId!,
      termsHash,
      codeHash: artifact.codeHash,
      buyerAddress: buyerBinding.address,
      sellerAddress: sellerBinding.address,
      arbitratorAddress: settings.arbitratorAddress,
      treasuryAddress: settings.treasuryAddress,
      buyerTotal: economics.buyerTotal,
      sellerPayout: economics.sellerPayout,
      platformFee: economics.platformFee,
      refundToBuyer,
      refundFee: settings.refundFee,
      fundingDeadline,
      deliveryDeadline,
      confirmationDeadline,
    });
    const queryId = queryIdFromQuoteHash(quoteHash);
    const composed = this.composer.compose({
      dealId: uuidToUint256(dealId),
      buyer: buyerBinding.address,
      seller: sellerBinding.address,
      arbitrator: settings.arbitratorAddress,
      treasury: settings.treasuryAddress,
      termsHash: BigInt(`0x${termsHash}`),
      quoteHash: BigInt(`0x${quoteHash}`),
      buyerTotal: economics.buyerTotal,
      sellerPayout: economics.sellerPayout,
      platformFee: economics.platformFee,
      refundToBuyer,
      refundFee: settings.refundFee,
      fundingDeadline: BigInt(fundingDeadline),
      deliveryDeadline: BigInt(deliveryDeadline),
      confirmationDeadline: BigInt(confirmationDeadline),
      queryId,
    });

    const preparation = manager.create(TonNativeEscrowPreparation, {
      id: quoteId,
      dealId,
      network: settings.network,
      chainId: deal.settlementChainId!,
      termsHash,
      quoteHash,
      codeHash: composed.codeHash,
      configHash: composed.configHash,
      escrowAddress: composed.escrowAddress,
      buyerAddress: buyerBinding.address,
      sellerAddress: sellerBinding.address,
      arbitratorAddress: settings.arbitratorAddress,
      treasuryAddress: settings.treasuryAddress,
      buyerTotalAtomic: economics.buyerTotal.toString(),
      sellerPayoutAtomic: economics.sellerPayout.toString(),
      platformFeeAtomic: economics.platformFee.toString(),
      refundToBuyerAtomic: refundToBuyer.toString(),
      refundFeeAtomic: settings.refundFee.toString(),
      requestAmountAtomic: composed.fundingAmount.toString(),
      queryId: queryId.toString(),
      fundingDeadline: String(fundingDeadline),
      deliveryDeadline: String(deliveryDeadline),
      confirmationDeadline: String(confirmationDeadline),
      stateInit: composed.stateInit,
      payload: composed.payload,
    });
    const saved = await manager.save(preparation);
    const dealUpdated = await manager.update(
      Deal,
      { id: deal.id, status: DealStatus.PENDING_PAYMENT },
      {
        quoteId,
        escrowAddress: composed.escrowAddress,
        buyerWalletAddress: buyerBinding.address,
        sellerWalletAddress: sellerBinding.address,
      },
    );
    if (dealUpdated.affected !== 1) {
      throw new ConflictException(
        "Deal changed while native TON funding was being prepared",
      );
    }
    return saved;
  }

  private assertDealCanBeFunded(
    deal: Deal,
    buyerId: string,
    network: TonNetwork,
  ): void {
    if (deal.buyerId !== buyerId) {
      throw new ForbiddenException("Only the buyer can fund this deal");
    }
    if (deal.status !== DealStatus.PENDING_PAYMENT) {
      throw new ConflictException("Deal is not awaiting payment");
    }
    if (!deal.sellerId) {
      throw new ConflictException("Deal has no accepted seller");
    }
    if (
      deal.settlementNetwork !== SettlementNetwork.TON ||
      deal.settlementMode !== SettlementMode.NATIVE ||
      deal.settlementAsset !== SettlementAsset.TON_NATIVE
    ) {
      throw new BadRequestException("Deal is not a native TON settlement");
    }
    const expectedChain =
      network === TonNetwork.MAINNET ? "mainnet" : "testnet";
    if (deal.settlementChainId !== expectedChain) {
      throw new ConflictException("Deal network does not match TON Connect");
    }
    if (deal.currency !== Currency.TON) {
      throw new BadRequestException(
        "Native TON settlement requires a TON-denominated deal",
      );
    }
    if (!deal.termsHash || !HASH_256.test(deal.termsHash.toLowerCase())) {
      throw new ConflictException("Deal terms are not committed");
    }
    if (!deal.deadline) {
      throw new ConflictException("Deal delivery deadline is required");
    }
  }

  private assertPreparationStillMatches(
    current: TonNativeEscrowPreparation,
    deal: Deal,
    buyer: TonWalletBinding,
    seller: TonWalletBinding,
    settings: NativeTonSettings,
    nowSeconds: number,
  ): void {
    if (BigInt(current.fundingDeadline) < BigInt(nowSeconds)) {
      throw new ConflictException(
        "Native TON funding quote expired and requires a new agreement",
      );
    }
    const artifactCodeHash = this.adapter.nativeArtifact.codeHash;
    if (
      current.termsHash !== deal.termsHash!.toLowerCase() ||
      current.buyerAddress !== buyer.address ||
      current.sellerAddress !== seller.address ||
      current.arbitratorAddress !== settings.arbitratorAddress ||
      current.treasuryAddress !== settings.treasuryAddress ||
      current.codeHash !== artifactCodeHash
    ) {
      throw new ConflictException(
        "Native TON funding commitment no longer matches current configuration",
      );
    }
    if (
      deal.quoteId !== current.id ||
      deal.escrowAddress !== current.escrowAddress ||
      deal.buyerWalletAddress !== current.buyerAddress ||
      deal.sellerWalletAddress !== current.sellerAddress
    ) {
      throw new ConflictException(
        "Deal does not reference its immutable native TON preparation",
      );
    }
  }

  private toResponse(
    preparation: TonNativeEscrowPreparation,
    nowSeconds: number,
    transactionTtl: number,
  ): TonNativeFundingResponse {
    const secondsRemaining = Number(preparation.fundingDeadline) - nowSeconds;
    if (!Number.isSafeInteger(secondsRemaining) || secondsRemaining < 30) {
      throw new ConflictException(
        "Native TON funding quote is too close to expiry",
      );
    }
    const transaction = buildTonConnectTransactionRequest({
      network: preparation.network,
      from: preparation.buyerAddress,
      nowSeconds,
      ttlSeconds: Math.min(transactionTtl, secondsRemaining),
      messages: [
        {
          address: preparation.escrowAddress,
          amount: BigInt(preparation.requestAmountAtomic),
          payload: preparation.payload,
          stateInit: preparation.stateInit,
        },
      ],
    });
    return {
      quoteId: preparation.id,
      quoteHash: preparation.quoteHash,
      termsHash: preparation.termsHash,
      codeHash: preparation.codeHash,
      configHash: preparation.configHash,
      escrowAddress: preparation.escrowAddress,
      buyerTotalAtomic: preparation.buyerTotalAtomic,
      sellerPayoutAtomic: preparation.sellerPayoutAtomic,
      platformFeeAtomic: preparation.platformFeeAtomic,
      refundToBuyerAtomic: preparation.refundToBuyerAtomic,
      refundFeeAtomic: preparation.refundFeeAtomic,
      operationalReserveAtomic: (
        BigInt(preparation.requestAmountAtomic) -
        BigInt(preparation.buyerTotalAtomic)
      ).toString(),
      fundingDeadline: Number(preparation.fundingDeadline),
      deliveryDeadline: Number(preparation.deliveryDeadline),
      confirmationDeadline: Number(preparation.confirmationDeadline),
      transaction,
    };
  }

  private getSettings(): NativeTonSettings {
    const networkValue = this.config.get<string>("TON_CONNECT_NETWORK", "");
    if (
      networkValue !== TonNetwork.MAINNET &&
      networkValue !== TonNetwork.TESTNET
    ) {
      throw new ServiceUnavailableException(
        "TON Connect network is not configured",
      );
    }
    return {
      network: networkValue,
      treasuryAddress: configuredBasechainAddress(
        this.config,
        "TON_NATIVE_TREASURY_ADDRESS",
      ),
      arbitratorAddress: configuredBasechainAddress(
        this.config,
        "TON_NATIVE_ARBITRATOR_ADDRESS",
      ),
      fundingWindow: configuredInteger(
        this.config,
        "TON_NATIVE_FUNDING_WINDOW_SECONDS",
        300,
        86_400,
        900,
      ),
      confirmationWindow: configuredInteger(
        this.config,
        "TON_NATIVE_CONFIRMATION_WINDOW_SECONDS",
        60,
        2_592_000,
        259_200,
      ),
      transactionTtl: configuredInteger(
        this.config,
        "TON_NATIVE_TRANSACTION_TTL_SECONDS",
        30,
        600,
        300,
      ),
      refundFee: configuredAtomicAmount(
        this.config,
        "TON_NATIVE_REFUND_FEE_NANO",
        "0",
      ),
    };
  }
}

interface NativeTonSettings {
  network: TonNetwork;
  treasuryAddress: string;
  arbitratorAddress: string;
  fundingWindow: number;
  confirmationWindow: number;
  transactionTtl: number;
  refundFee: bigint;
}

export function decimalTonToNano(value: number | string): bigint {
  const raw = String(value).trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(raw)) {
    throw new BadRequestException("TON amount is not an exact decimal");
  }
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > 9) {
    throw new BadRequestException("TON amount has more than 9 decimal places");
  }
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

export function computeNativeTonEconomics(
  amount: number | string,
  commissionAmount: number | string,
  feeModel: FeeModel,
): NativeTonEconomics {
  const principal = decimalTonToNano(amount);
  const commission = decimalTonToNano(commissionAmount);
  let buyerTotal: bigint;
  let sellerPayout: bigint;
  switch (feeModel) {
    case FeeModel.SELLER_PAYS:
      buyerTotal = principal;
      sellerPayout = principal - commission;
      break;
    case FeeModel.SPLIT_50_50:
      if (commission % 2n !== 0n) {
        throw new BadRequestException(
          "TON split commission is not divisible into whole nanotons",
        );
      }
      buyerTotal = principal + commission / 2n;
      sellerPayout = principal - commission / 2n;
      break;
    case FeeModel.BUYER_PAYS:
      buyerTotal = principal + commission;
      sellerPayout = principal;
      break;
    default:
      throw new BadRequestException("Unsupported TON fee model");
  }
  if (principal <= 0n || commission < 0n || sellerPayout < 0n) {
    throw new BadRequestException("Invalid native TON economics");
  }
  return {
    buyerTotal,
    sellerPayout,
    platformFee: buyerTotal - sellerPayout,
  };
}

function hashNativeTonQuote(input: {
  quoteId: string;
  dealId: string;
  chainId: string;
  termsHash: string;
  codeHash: string;
  buyerAddress: string;
  sellerAddress: string;
  arbitratorAddress: string;
  treasuryAddress: string;
  buyerTotal: bigint;
  sellerPayout: bigint;
  platformFee: bigint;
  refundToBuyer: bigint;
  refundFee: bigint;
  fundingDeadline: number;
  deliveryDeadline: number;
  confirmationDeadline: number;
}): string {
  const canonical = {
    version: 1,
    quoteId: input.quoteId,
    dealId: input.dealId,
    network: SettlementNetwork.TON,
    chainId: input.chainId,
    asset: SettlementAsset.TON_NATIVE,
    termsHash: input.termsHash,
    codeHash: input.codeHash,
    buyerAddress: input.buyerAddress,
    sellerAddress: input.sellerAddress,
    arbitratorAddress: input.arbitratorAddress,
    treasuryAddress: input.treasuryAddress,
    buyerTotalAtomic: input.buyerTotal.toString(),
    sellerPayoutAtomic: input.sellerPayout.toString(),
    platformFeeAtomic: input.platformFee.toString(),
    refundToBuyerAtomic: input.refundToBuyer.toString(),
    refundFeeAtomic: input.refundFee.toString(),
    fundingDeadline: input.fundingDeadline,
    deliveryDeadline: input.deliveryDeadline,
    confirmationDeadline: input.confirmationDeadline,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function queryIdFromQuoteHash(quoteHash: string): bigint {
  const value = BigInt(`0x${quoteHash.slice(0, 16)}`);
  return value === 0n ? 1n : value;
}

function uuidToUint256(value: string): bigint {
  const hex = value.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new BadRequestException("Deal id is not a UUID");
  }
  const result = BigInt(`0x${hex}`);
  if (result === 0n) throw new BadRequestException("Deal id cannot be zero");
  return result;
}

function toUnixSeconds(value: Date | null): number {
  const milliseconds = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(milliseconds)) {
    throw new ConflictException("Deal delivery deadline is invalid");
  }
  return Math.floor(milliseconds / 1_000);
}

function configuredBasechainAddress(
  config: ConfigService,
  key: string,
): string {
  const value = config.get<string>(key, "").trim();
  try {
    const address = Address.parse(value);
    if (address.workChain !== 0) throw new Error("not basechain");
    return address.toRawString().toLowerCase();
  } catch {
    throw new ServiceUnavailableException(`${key} is not configured safely`);
  }
}

function configuredInteger(
  config: ConfigService,
  key: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const value = Number(config.get(key, String(fallback)));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ServiceUnavailableException(`${key} is not configured safely`);
  }
  return value;
}

function configuredAtomicAmount(
  config: ConfigService,
  key: string,
  fallback: string,
): bigint {
  const value = String(config.get(key, fallback));
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) {
    throw new ServiceUnavailableException(`${key} is not configured safely`);
  }
  return BigInt(value);
}
