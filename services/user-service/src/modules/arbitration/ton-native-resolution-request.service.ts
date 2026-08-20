import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager, FindOneOptions } from "typeorm";
import {
  buildTonConnectTransactionRequest,
  TonConnectTransactionRequest,
} from "../blockchain/ton-connect-transaction";
import { Deal } from "../deal/entities/deal.entity";
import { TonNativeEscrowPreparation } from "../deal/entities/ton-native-escrow-preparation.entity";
import { TonNativeLifecycleIntent } from "../deal/entities/ton-native-lifecycle-intent.entity";
import { DealStatus } from "../deal/enums/deal.enum";
import {
  buildTonNativeLifecyclePayload,
  parseTonNativeLifecyclePayload,
  TON_NATIVE_CONTRACT_STATUS,
  TonNativeLifecycleAction,
} from "../deal/ton-native-lifecycle";
import { TonEscrowAdapter } from "../escrow/adapters/ton-escrow.adapter";
import { TonWalletBinding } from "../user/entities/ton-wallet-binding.entity";
import { UserType } from "../user/entities/user.entity";
import { ArbitrationDecision } from "./entities/arbitration-decision.entity";
import {
  ArbitrationDecisionType,
  DisputeStatus,
} from "./entities/enums/arbitration.enum";

export interface TonNativeResolutionRequestResponse {
  intentId: string;
  decisionId: string;
  decisionHash: string;
  queryId: string;
  buyerAwardAtomic: string;
  sellerAwardAtomic: string;
  platformFeeAtomic: string;
  escrowAddress: string;
  transaction: TonConnectTransactionRequest;
}

@Injectable()
export class TonNativeResolutionRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly adapter: TonEscrowAdapter,
  ) {}

  async buildRequest(
    decisionId: string,
    userId: string,
    roles: UserType[],
    nowSeconds = Math.floor(Date.now() / 1_000),
  ): Promise<TonNativeResolutionRequestResponse> {
    if (!this.adapter.isReady()) {
      throw new ServiceUnavailableException(
        "Native TON resolution is not enabled yet",
      );
    }
    if (
      !roles.includes(UserType.ADMIN) &&
      !roles.includes(UserType.SUPER_ADMIN)
    ) {
      throw new ForbiddenException(
        "Only an authorized resolution operator can prepare TON enforcement",
      );
    }
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new ServiceUnavailableException("Invalid resolution request time");
    }
    const actionValue = configuredAtomicAmount(
      this.config,
      "TON_NATIVE_ACTION_VALUE_NANO",
      "50000000",
      1_000_000n,
      1_000_000_000n,
    );
    const ttlSeconds = configuredInteger(
      this.config,
      "TON_NATIVE_TRANSACTION_TTL_SECONDS",
      30,
      600,
      300,
    );
    const prepared = await this.dataSource.transaction((manager) =>
      this.loadOrCreateIntent(
        manager,
        decisionId,
        userId,
        nowSeconds,
        actionValue,
      ),
    );
    return {
      intentId: prepared.intent.id,
      decisionId,
      decisionHash: prepared.intent.decisionHash!,
      queryId: prepared.intent.queryId,
      buyerAwardAtomic: prepared.intent.buyerAwardAtomic!,
      sellerAwardAtomic: prepared.intent.sellerAwardAtomic!,
      platformFeeAtomic: prepared.preparation.platformFeeAtomic,
      escrowAddress: prepared.preparation.escrowAddress,
      transaction: buildTonConnectTransactionRequest({
        network: prepared.preparation.network,
        from: prepared.intent.senderAddress,
        nowSeconds,
        ttlSeconds,
        messages: [
          {
            address: prepared.preparation.escrowAddress,
            amount: BigInt(prepared.intent.actionValueAtomic),
            payload: prepared.intent.payload,
          },
        ],
      }),
    };
  }

  private async loadOrCreateIntent(
    manager: EntityManager,
    decisionId: string,
    userId: string,
    nowSeconds: number,
    actionValue: bigint,
  ): Promise<{
    intent: TonNativeLifecycleIntent;
    preparation: TonNativeEscrowPreparation;
  }> {
    const options: FindOneOptions<ArbitrationDecision> = {
      where: { id: decisionId },
      relations: ["dispute"],
    };
    if (this.dataSource.options.type === "postgres") {
      Object.assign(options, { lock: { mode: "pessimistic_write" } });
    }
    const decision = await manager.findOne(ArbitrationDecision, options);
    if (!decision)
      throw new NotFoundException("Arbitration decision not found");
    const dispute = decision.dispute;
    if (!dispute || dispute.decisionId !== decision.id) {
      throw new ConflictException("Decision is not committed to its dispute");
    }
    if (
      dispute.status !== DisputeStatus.DECISION_MADE &&
      dispute.status !== DisputeStatus.APPEAL_PERIOD
    ) {
      throw new ConflictException(
        "Dispute decision is not ready for enforcement",
      );
    }
    if (dispute.appealId || decision.isEnforced) {
      throw new ConflictException("Decision is appealed or already enforced");
    }
    if (decision.arbitratorId !== dispute.arbitratorId) {
      throw new ConflictException(
        "Assigned arbitrator does not match decision",
      );
    }
    if (decision.isAppealable) {
      const createdAt = decision.createdAt?.getTime();
      if (!Number.isFinite(createdAt)) {
        throw new ConflictException("Decision timestamp is invalid");
      }
      const appealDeadline =
        createdAt! + decision.appealPeriodHours * 60 * 60 * 1_000;
      if (nowSeconds * 1_000 < appealDeadline) {
        throw new ConflictException("Appeal period has not expired");
      }
    }

    const deal = await manager.findOne(Deal, {
      where: { id: dispute.dealId },
    });
    if (!deal || deal.status !== DealStatus.DISPUTED) {
      throw new ConflictException("Deal is not awaiting dispute resolution");
    }
    const preparation = await manager.findOne(TonNativeEscrowPreparation, {
      where: { dealId: deal.id },
    });
    if (!preparation || preparation.id !== deal.quoteId) {
      throw new ConflictException("Native TON preparation is missing or stale");
    }
    const binding = await manager.findOne(TonWalletBinding, {
      where: { userId, network: preparation.network },
    });
    if (!binding || binding.address !== preparation.arbitratorAddress) {
      throw new ForbiddenException(
        "Connect the resolver-authority wallet committed to this escrow",
      );
    }

    const awards = awardsForDecision(decision, preparation);
    const decisionHash = hashDecision(decision, awards);
    const existing = await manager.findOne(TonNativeLifecycleIntent, {
      where: { decisionId: decision.id },
    });
    if (existing) {
      if (
        existing.requesterUserId !== userId ||
        existing.senderAddress !== preparation.arbitratorAddress ||
        existing.decisionHash !== decisionHash ||
        existing.buyerAwardAtomic !== awards.buyerAward.toString() ||
        existing.sellerAwardAtomic !== awards.sellerAward.toString()
      ) {
        throw new ConflictException(
          "A different immutable TON resolution is already prepared",
        );
      }
      return { intent: existing, preparation };
    }

    const queryId = queryIdFromUuid(randomUUID());
    const payload = buildTonNativeLifecyclePayload(
      TonNativeLifecycleAction.RESOLVE,
      queryId,
      awards,
    );
    const parsed = parseTonNativeLifecyclePayload(payload);
    const intent = manager.create(TonNativeLifecycleIntent, {
      preparationId: preparation.id,
      dealId: deal.id,
      action: TonNativeLifecycleAction.RESOLVE,
      expectedFromStatus: TON_NATIVE_CONTRACT_STATUS.DISPUTED,
      expectedToStatus: TON_NATIVE_CONTRACT_STATUS.RESOLVED,
      requesterUserId: userId,
      senderAddress: preparation.arbitratorAddress,
      queryId: queryId.toString(),
      actionValueAtomic: actionValue.toString(),
      payload,
      payloadHash: parsed.hash,
      reason: null,
      decisionId: decision.id,
      decisionHash,
      buyerAwardAtomic: awards.buyerAward.toString(),
      sellerAwardAtomic: awards.sellerAward.toString(),
      consumedByEventId: null,
      consumedAt: null,
    });
    return { intent: await manager.save(intent), preparation };
  }
}

function awardsForDecision(
  decision: ArbitrationDecision,
  preparation: TonNativeEscrowPreparation,
): { buyerAward: bigint; sellerAward: bigint } {
  const buyerBps: Record<ArbitrationDecisionType, bigint> = {
    [ArbitrationDecisionType.FULL_REFUND_TO_BUYER]: 10_000n,
    [ArbitrationDecisionType.PARTIAL_REFUND_TO_BUYER]: 5_000n,
    [ArbitrationDecisionType.FULL_PAYMENT_TO_SELLER]: 0n,
    [ArbitrationDecisionType.PARTIAL_PAYMENT_TO_SELLER]: 3_000n,
    [ArbitrationDecisionType.SPLIT_FUNDS]: 5_000n,
    [ArbitrationDecisionType.REFUND_NO_PENALTY]: 10_000n,
  };
  const bps = buyerBps[decision.decisionType];
  if (bps === undefined) {
    throw new ConflictException("Unsupported native TON arbitration decision");
  }
  const buyerTotal = parseAtomic(preparation.buyerTotalAtomic);
  const platformFee = parseAtomic(preparation.platformFeeAtomic);
  if (platformFee > buyerTotal) {
    throw new ConflictException("Committed TON economics are invalid");
  }
  const distributable = buyerTotal - platformFee;
  const buyerAward = (distributable * bps) / 10_000n;
  return { buyerAward, sellerAward: distributable - buyerAward };
}

function hashDecision(
  decision: ArbitrationDecision,
  awards: { buyerAward: bigint; sellerAward: bigint },
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: decision.id,
        disputeId: decision.disputeId,
        arbitratorId: decision.arbitratorId,
        decisionType: decision.decisionType,
        reasoning: decision.reasoning,
        createdAt: decision.createdAt.toISOString(),
        buyerAwardAtomic: awards.buyerAward.toString(),
        sellerAwardAtomic: awards.sellerAward.toString(),
      }),
    )
    .digest("hex");
}

function queryIdFromUuid(value: string): bigint {
  const digest = createHash("sha256").update(value).digest("hex");
  const queryId = BigInt(`0x${digest.slice(0, 16)}`);
  return queryId === 0n ? 1n : queryId;
}

function parseAtomic(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new ConflictException("Committed TON amount is invalid");
  }
  return BigInt(value);
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
  minimum: bigint,
  maximum: bigint,
): bigint {
  const raw = String(config.get(key, fallback));
  if (!/^\d+$/.test(raw)) {
    throw new ServiceUnavailableException(`${key} is not configured safely`);
  }
  const value = BigInt(raw);
  if (value < minimum || value > maximum) {
    throw new ServiceUnavailableException(`${key} is not configured safely`);
  }
  return value;
}
