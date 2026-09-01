import { createHash } from "crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, IsNull } from "typeorm";
import { Deal } from "./entities/deal.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import {
  TonJettonEscrowWatch,
  TonJettonEscrowWatchStatus,
} from "./entities/ton-jetton-escrow-watch.entity";
import {
  DealStatus,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "./enums/deal.enum";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { SettlementCircuitScope } from "../safety/entities/settlement-circuit-breaker.entity";

const HASH_256 = /^[0-9a-f]{64}$/;
const RAW_TON_ADDRESS = /^(-?\d+):[0-9a-f]{64}$/;
const UINT64_MAX = (1n << 64n) - 1n;
const COINS_MAX = (1n << 120n) - 1n;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface TonJettonPreparationInput {
  dealId: string;
  network: TonNetwork;
  workchain: number;
  codeHash: string;
  configHash: string;
  escrowAddress: string;
  stateInit: string;
  masterAddress: string;
  walletCodeHash: string;
  sealedWalletAddress: string;
  walletVerificationEvidenceHash: string;
  termsVersion: number;
  termsHash: string;
  quoteVersion: number;
  quoteId: string;
  quoteHash: string;
  buyerAddress: string;
  sellerAddress: string;
  arbitratorAddress: string;
  treasuryAddress: string;
  initializerAddress: string;
  reconciliationAddress: string;
  assetCode: "USDT-TON";
  assetDecimals: 6;
  buyerTotalAtomic: string;
  sellerPayoutAtomic: string;
  platformFeeAtomic: string;
  refundToBuyerAtomic: string;
  refundFeeAtomic: string;
  fundingQueryId: string;
  fundingForwardPayloadHash: string;
  fundingDeadline: string;
  deliveryDeadline: string;
  confirmationDeadline: string;
}

export type TonJettonPreparationResult =
  | { status: "created"; preparation: TonJettonEscrowPreparation }
  | { status: "replayed"; preparation: TonJettonEscrowPreparation };

/** Creates immutable preparation versions while holding the deal row lock. */
@Injectable()
export class TonJettonPreparationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly circuitBreaker: SettlementCircuitBreakerService,
  ) {}

  async prepare(
    input: TonJettonPreparationInput,
  ): Promise<TonJettonPreparationResult> {
    validatePreparation(input);
    return this.dataSource.transaction((manager) =>
      this.prepareLocked(manager, input),
    );
  }

  private async prepareLocked(
    manager: EntityManager,
    input: TonJettonPreparationInput,
  ): Promise<TonJettonPreparationResult> {
    const dealRepo = manager.getRepository(Deal);
    let dealQuery = dealRepo
      .createQueryBuilder("deal")
      .where("deal.id = :dealId", { dealId: input.dealId });
    if (this.dataSource.options.type === "postgres") {
      dealQuery = dealQuery.setLock("pessimistic_write");
    }
    const deal = await dealQuery.getOne();
    if (!deal) throw new NotFoundException("Deal not found");
    assertDealBinding(deal, input);
    await this.circuitBreaker.assertFundingAllowed(
      SettlementCircuitScope.TON,
      manager,
    );

    const repository = manager.getRepository(TonJettonEscrowPreparation);
    let currentQuery = repository
      .createQueryBuilder("preparation")
      .where("preparation.dealId = :dealId", { dealId: input.dealId })
      .orderBy("preparation.version", "DESC")
      .take(1);
    if (this.dataSource.options.type === "postgres") {
      currentQuery = currentQuery.setLock("pessimistic_read");
    }
    const current = await currentQuery.getOne();
    const contentHash = preparationContentHash(input);
    if (current?.contentHash === contentHash) {
      return { status: "replayed", preparation: current };
    }
    if (deal.fundedAt !== null) {
      throw new ConflictException(
        "JETTON_FUNDED_PREPARATION_VERSION_IS_IMMUTABLE",
      );
    }

    const watchRepo = manager.getRepository(TonJettonEscrowWatch);
    let currentWatch: TonJettonEscrowWatch | null = null;
    if (current) {
      let watchQuery = watchRepo
        .createQueryBuilder("watch")
        .where("watch.preparationId = :preparationId", {
          preparationId: current.id,
        });
      if (this.dataSource.options.type === "postgres") {
        watchQuery = watchQuery.setLock("pessimistic_write");
      }
      currentWatch = await watchQuery.getOne();
      if (
        currentWatch &&
        currentWatch.status !== TonJettonEscrowWatchStatus.AWAITING_FUNDING
      ) {
        throw new ConflictException(
          "JETTON_ACTIVE_PREPARATION_CANNOT_BE_SUPERSEDED",
        );
      }
    }

    const preparation = repository.create({
      ...input,
      version: (current?.version ?? 0) + 1,
      previousPreparationId: current?.id ?? null,
      contentHash,
    });
    const saved = await repository.save(preparation);

    if (currentWatch) {
      currentWatch.status = TonJettonEscrowWatchStatus.SUPERSEDED;
      await watchRepo.save(currentWatch);
    }
    await watchRepo.save(
      watchRepo.create({
        preparationId: saved.id,
        dealId: saved.dealId,
        network: saved.network,
        accountAddress: saved.escrowAddress,
        status: TonJettonEscrowWatchStatus.AWAITING_FUNDING,
        consecutiveFailures: 0,
        lastError: null,
        lastAppliedAt: null,
      }),
    );

    const updated = await dealRepo.update(
      {
        id: deal.id,
        status: DealStatus.PENDING_PAYMENT,
        fundedAt: IsNull(),
      },
      {
        quoteId: input.quoteId,
        escrowAddress: input.escrowAddress,
        buyerWalletAddress: input.buyerAddress,
        sellerWalletAddress: input.sellerAddress,
      },
    );
    if (updated.affected !== 1) {
      throw new ConflictException("JETTON_DEAL_CHANGED_DURING_PREPARATION");
    }
    return { status: "created", preparation: saved };
  }
}

export function preparationContentHash(
  input: TonJettonPreparationInput,
): string {
  const canonical = Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256")
    .update("TON_JETTON_PREPARATION_V1\0", "utf8")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

function validatePreparation(input: TonJettonPreparationInput): void {
  if (!UUID.test(input.dealId) || !UUID.test(input.quoteId)) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_ID");
  }
  if (!Object.values(TonNetwork).includes(input.network)) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_NETWORK");
  }
  if (
    !Number.isInteger(input.workchain) ||
    input.workchain < -1 ||
    input.workchain > 0
  ) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_WORKCHAIN");
  }
  for (const [label, value] of Object.entries({
    codeHash: input.codeHash,
    configHash: input.configHash,
    walletCodeHash: input.walletCodeHash,
    walletVerificationEvidenceHash: input.walletVerificationEvidenceHash,
    termsHash: input.termsHash,
    quoteHash: input.quoteHash,
    fundingForwardPayloadHash: input.fundingForwardPayloadHash,
  })) {
    if (!HASH_256.test(value) || value === "0".repeat(64)) {
      throw new BadRequestException(
        `INVALID_JETTON_PREPARATION_${label.toUpperCase()}`,
      );
    }
  }
  for (const [label, value] of Object.entries({
    escrowAddress: input.escrowAddress,
    masterAddress: input.masterAddress,
    sealedWalletAddress: input.sealedWalletAddress,
    buyerAddress: input.buyerAddress,
    sellerAddress: input.sellerAddress,
    arbitratorAddress: input.arbitratorAddress,
    treasuryAddress: input.treasuryAddress,
    initializerAddress: input.initializerAddress,
    reconciliationAddress: input.reconciliationAddress,
  })) {
    const match = RAW_TON_ADDRESS.exec(value);
    if (!match || Number(match[1]) !== input.workchain) {
      throw new BadRequestException(
        `INVALID_JETTON_PREPARATION_${label.toUpperCase()}`,
      );
    }
  }
  if (
    typeof input.stateInit !== "string" ||
    input.stateInit.length < 4 ||
    input.stateInit.length > 65_536 ||
    input.stateInit.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.stateInit)
  ) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_STATE_INIT");
  }
  if (
    !Number.isSafeInteger(input.termsVersion) ||
    input.termsVersion < 1 ||
    !Number.isSafeInteger(input.quoteVersion) ||
    input.quoteVersion < 1
  ) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_VERSION");
  }
  if (input.assetCode !== "USDT-TON" || input.assetDecimals !== 6) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_ASSET");
  }
  const amounts = [
    input.buyerTotalAtomic,
    input.sellerPayoutAtomic,
    input.platformFeeAtomic,
    input.refundToBuyerAtomic,
    input.refundFeeAtomic,
  ].map(parseCoins);
  if (amounts[0] === 0n) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_BUYER_TOTAL");
  }
  if (amounts[1] + amounts[2] !== amounts[0]) {
    throw new BadRequestException(
      "INVALID_JETTON_PREPARATION_RELEASE_CONSERVATION",
    );
  }
  if (amounts[3] + amounts[4] !== amounts[0]) {
    throw new BadRequestException(
      "INVALID_JETTON_PREPARATION_REFUND_CONSERVATION",
    );
  }
  const queryId = parseUint64(input.fundingQueryId);
  const funding = parseUint64(input.fundingDeadline);
  const delivery = parseUint64(input.deliveryDeadline);
  const confirmation = parseUint64(input.confirmationDeadline);
  if (queryId === 0n) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_QUERY_ID");
  }
  if (!(funding < delivery && delivery < confirmation)) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_DEADLINES");
  }
}

function assertDealBinding(deal: Deal, input: TonJettonPreparationInput): void {
  if (
    deal.status !== DealStatus.PENDING_PAYMENT ||
    deal.settlementNetwork !== SettlementNetwork.TON ||
    deal.settlementMode !== SettlementMode.NATIVE ||
    deal.settlementAsset !== SettlementAsset.TON_USDT ||
    deal.settlementChainId !== input.network ||
    deal.assetContract !== input.masterAddress
  ) {
    throw new ConflictException("JETTON_DEAL_SETTLEMENT_BINDING_MISMATCH");
  }
  if (
    deal.termsVersion !== input.termsVersion ||
    deal.termsHash?.toLowerCase() !== input.termsHash
  ) {
    throw new ConflictException("JETTON_DEAL_TERMS_MISMATCH");
  }
  if (
    (deal.buyerWalletAddress &&
      deal.buyerWalletAddress !== input.buyerAddress) ||
    (deal.sellerWalletAddress &&
      deal.sellerWalletAddress !== input.sellerAddress)
  ) {
    throw new ConflictException("JETTON_DEAL_PARTICIPANT_WALLET_MISMATCH");
  }
}

function parseCoins(value: string): bigint {
  if (!/^(0|[1-9]\d{0,77})$/.test(value)) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_AMOUNT");
  }
  const parsed = BigInt(value);
  if (parsed > COINS_MAX) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_AMOUNT");
  }
  return parsed;
}

function parseUint64(value: string): bigint {
  if (!/^(0|[1-9]\d{0,19})$/.test(value)) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_UINT64");
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) {
    throw new BadRequestException("INVALID_JETTON_PREPARATION_UINT64");
  }
  return parsed;
}
