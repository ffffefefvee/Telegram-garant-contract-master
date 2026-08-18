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
import {
  buildTonConnectTransactionRequest,
  TonConnectTransactionRequest,
} from "../blockchain/ton-connect-transaction";
import { TonEscrowAdapter } from "../escrow/adapters/ton-escrow.adapter";
import { TonWalletBinding } from "../user/entities/ton-wallet-binding.entity";
import { Deal } from "./entities/deal.entity";
import { TonNativeEscrowPreparation } from "./entities/ton-native-escrow-preparation.entity";
import { TonNativeLifecycleIntent } from "./entities/ton-native-lifecycle-intent.entity";
import {
  DealStatus,
  SettlementAsset,
  SettlementMode,
  SettlementNetwork,
} from "./enums/deal.enum";
import {
  buildTonNativeLifecyclePayload,
  parseTonNativeLifecyclePayload,
  TON_NATIVE_CONTRACT_STATUS,
  TonNativeLifecycleAction,
} from "./ton-native-lifecycle";

export interface TonNativeLifecycleRequestResponse {
  intentId: string;
  action: TonNativeLifecycleAction;
  expectedFromStatus: number;
  expectedToStatus: number;
  queryId: string;
  escrowAddress: string;
  transaction: TonConnectTransactionRequest;
}

type RequiredRole = "buyer" | "seller" | "participant";

interface ActionPolicy {
  role: RequiredRole;
  dealStatuses: DealStatus[];
  fromStatus: number;
  toStatus: number;
  deadline: "delivery" | "confirmation" | "none";
  timing: "before" | "after" | "none";
  validForSeconds?: number;
}

@Injectable()
export class TonNativeLifecycleRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly adapter: TonEscrowAdapter,
  ) {}

  async buildRequest(
    dealId: string,
    userId: string,
    action: TonNativeLifecycleAction,
    reason?: string,
    nowSeconds = Math.floor(Date.now() / 1_000),
  ): Promise<TonNativeLifecycleRequestResponse> {
    if (!this.adapter.isReady()) {
      throw new ServiceUnavailableException(
        "Native TON lifecycle actions are not enabled yet",
      );
    }
    if (!Object.values(TonNativeLifecycleAction).includes(action)) {
      throw new BadRequestException("Unsupported native TON lifecycle action");
    }
    if (action === TonNativeLifecycleAction.RESOLVE) {
      throw new ForbiddenException(
        "Native TON resolution uses the privileged arbitration endpoint",
      );
    }
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new BadRequestException("Invalid lifecycle request time");
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
    const intent = await this.dataSource.transaction((manager) =>
      this.loadOrCreateIntent(
        manager,
        dealId,
        userId,
        action,
        reason,
        nowSeconds,
        actionValue,
      ),
    );
    const validForSeconds = (
      intent as TonNativeLifecycleIntent & {
        validForSeconds: number;
      }
    ).validForSeconds;
    return {
      intentId: intent.id,
      action: intent.action,
      expectedFromStatus: intent.expectedFromStatus,
      expectedToStatus: intent.expectedToStatus,
      queryId: intent.queryId,
      escrowAddress: (
        intent as TonNativeLifecycleIntent & {
          escrowAddress: string;
          network: TonNativeEscrowPreparation["network"];
        }
      ).escrowAddress,
      transaction: buildTonConnectTransactionRequest({
        network: (
          intent as TonNativeLifecycleIntent & {
            network: TonNativeEscrowPreparation["network"];
          }
        ).network,
        from: intent.senderAddress,
        nowSeconds,
        ttlSeconds: Math.min(ttlSeconds, validForSeconds),
        messages: [
          {
            address: (
              intent as TonNativeLifecycleIntent & {
                escrowAddress: string;
              }
            ).escrowAddress,
            amount: BigInt(intent.actionValueAtomic),
            payload: intent.payload,
          },
        ],
      }),
    };
  }

  private async loadOrCreateIntent(
    manager: EntityManager,
    dealId: string,
    userId: string,
    action: TonNativeLifecycleAction,
    reason: string | undefined,
    nowSeconds: number,
    actionValue: bigint,
  ): Promise<TonNativeLifecycleIntent> {
    const options: FindOneOptions<Deal> = { where: { id: dealId } };
    if (this.dataSource.options.type === "postgres") {
      Object.assign(options, { lock: { mode: "pessimistic_write" } });
    }
    const deal = await manager.findOne(Deal, options);
    if (!deal) throw new NotFoundException("Deal not found");
    this.assertNativeTonDeal(deal);

    const preparation = await manager.findOne(TonNativeEscrowPreparation, {
      where: { dealId },
    });
    if (!preparation || preparation.id !== deal.quoteId) {
      throw new ConflictException("Native TON preparation is missing or stale");
    }
    const policy = this.policyFor(action, deal, preparation, nowSeconds);
    const senderAddress = this.assertRole(
      deal,
      preparation,
      userId,
      policy.role,
    );
    const binding = await manager.findOne(TonWalletBinding, {
      where: { userId, network: preparation.network },
    });
    if (!binding || binding.address !== senderAddress) {
      throw new ConflictException(
        "Reconnect the TON wallet committed to this escrow before signing",
      );
    }

    const normalizedReason = this.normalizeReason(action, reason);
    const existing = await manager.findOne(TonNativeLifecycleIntent, {
      where: {
        preparationId: preparation.id,
        action,
        expectedFromStatus: policy.fromStatus,
        requesterUserId: userId,
      },
    });
    if (existing) {
      if (existing.reason !== normalizedReason) {
        throw new ConflictException(
          "This lifecycle action already has a different immutable reason",
        );
      }
      return this.attachPreparation(
        existing,
        preparation,
        policy.validForSeconds ?? 600,
      );
    }

    const queryId = queryIdFromUuid(randomUUID());
    const payload = buildTonNativeLifecyclePayload(action, queryId);
    const parsed = parseTonNativeLifecyclePayload(payload);
    const intent = manager.create(TonNativeLifecycleIntent, {
      preparationId: preparation.id,
      dealId,
      action,
      expectedFromStatus: policy.fromStatus,
      expectedToStatus: policy.toStatus,
      requesterUserId: userId,
      senderAddress,
      queryId: queryId.toString(),
      actionValueAtomic: actionValue.toString(),
      payload,
      payloadHash: parsed.hash,
      reason: normalizedReason,
      decisionId: null,
      decisionHash: null,
      buyerAwardAtomic: null,
      sellerAwardAtomic: null,
      consumedByEventId: null,
      consumedAt: null,
    });
    return this.attachPreparation(
      await manager.save(intent),
      preparation,
      policy.validForSeconds ?? 600,
    );
  }

  private policyFor(
    action: TonNativeLifecycleAction,
    deal: Deal,
    preparation: TonNativeEscrowPreparation,
    nowSeconds: number,
  ): ActionPolicy {
    const policies: Partial<Record<TonNativeLifecycleAction, ActionPolicy>> = {
      [TonNativeLifecycleAction.MARK_DELIVERED]: {
        role: "seller",
        dealStatuses: [DealStatus.IN_PROGRESS],
        fromStatus: TON_NATIVE_CONTRACT_STATUS.FUNDED,
        toStatus: TON_NATIVE_CONTRACT_STATUS.DELIVERED,
        deadline: "delivery",
        timing: "before",
      },
      [TonNativeLifecycleAction.RELEASE]: {
        role: "buyer",
        dealStatuses: [DealStatus.PENDING_CONFIRMATION],
        fromStatus: TON_NATIVE_CONTRACT_STATUS.DELIVERED,
        toStatus: TON_NATIVE_CONTRACT_STATUS.RELEASED,
        deadline: "confirmation",
        timing: "before",
      },
      [TonNativeLifecycleAction.OPEN_DISPUTE]: {
        role: "participant",
        dealStatuses: [DealStatus.IN_PROGRESS, DealStatus.PENDING_CONFIRMATION],
        fromStatus:
          deal.status === DealStatus.IN_PROGRESS
            ? TON_NATIVE_CONTRACT_STATUS.FUNDED
            : TON_NATIVE_CONTRACT_STATUS.DELIVERED,
        toStatus: TON_NATIVE_CONTRACT_STATUS.DISPUTED,
        deadline:
          deal.status === DealStatus.IN_PROGRESS ? "delivery" : "confirmation",
        timing: "before",
      },
      [TonNativeLifecycleAction.REFUND_BUYER]: {
        role: "seller",
        dealStatuses: [DealStatus.IN_PROGRESS, DealStatus.PENDING_CONFIRMATION],
        fromStatus:
          deal.status === DealStatus.IN_PROGRESS
            ? TON_NATIVE_CONTRACT_STATUS.FUNDED
            : TON_NATIVE_CONTRACT_STATUS.DELIVERED,
        toStatus: TON_NATIVE_CONTRACT_STATUS.REFUNDED,
        deadline: "none",
        timing: "none",
      },
      [TonNativeLifecycleAction.REFUND_AFTER_SELLER_TIMEOUT]: {
        role: "participant",
        dealStatuses: [DealStatus.IN_PROGRESS],
        fromStatus: TON_NATIVE_CONTRACT_STATUS.FUNDED,
        toStatus: TON_NATIVE_CONTRACT_STATUS.REFUNDED,
        deadline: "delivery",
        timing: "after",
      },
      [TonNativeLifecycleAction.RELEASE_AFTER_BUYER_TIMEOUT]: {
        role: "participant",
        dealStatuses: [DealStatus.PENDING_CONFIRMATION],
        fromStatus: TON_NATIVE_CONTRACT_STATUS.DELIVERED,
        toStatus: TON_NATIVE_CONTRACT_STATUS.RELEASED,
        deadline: "confirmation",
        timing: "after",
      },
    };
    const policy = policies[action];
    if (!policy) {
      throw new BadRequestException("Unsupported participant lifecycle action");
    }
    if (!policy.dealStatuses.includes(deal.status)) {
      throw new ConflictException(
        "Deal state does not allow this native TON action",
      );
    }
    const deadline =
      policy.deadline === "delivery"
        ? Number(preparation.deliveryDeadline)
        : policy.deadline === "confirmation"
          ? Number(preparation.confirmationDeadline)
          : null;
    if (deadline !== null) {
      if (!Number.isSafeInteger(deadline)) {
        throw new ConflictException("Committed TON deadline is invalid");
      }
      if (policy.timing === "before" && nowSeconds > deadline) {
        throw new ConflictException("TON action deadline has passed");
      }
      if (policy.timing === "after" && nowSeconds <= deadline) {
        throw new ConflictException("TON timeout action is not available yet");
      }
      if (policy.timing === "before") {
        policy.validForSeconds = deadline - nowSeconds;
        if (policy.validForSeconds < 30) {
          throw new ConflictException(
            "TON action is too close to its on-chain deadline",
          );
        }
      }
    }
    return policy;
  }

  private assertRole(
    deal: Deal,
    preparation: TonNativeEscrowPreparation,
    userId: string,
    role: RequiredRole,
  ): string {
    if (role === "buyer") {
      if (deal.buyerId !== userId) {
        throw new ForbiddenException("Only the buyer can request this action");
      }
      return preparation.buyerAddress;
    }
    if (role === "seller") {
      if (deal.sellerId !== userId) {
        throw new ForbiddenException("Only the seller can request this action");
      }
      return preparation.sellerAddress;
    }
    if (deal.buyerId === userId) return preparation.buyerAddress;
    if (deal.sellerId === userId) return preparation.sellerAddress;
    throw new ForbiddenException(
      "Only a deal participant can request this action",
    );
  }

  private normalizeReason(
    action: TonNativeLifecycleAction,
    reason: string | undefined,
  ): string | null {
    if (action !== TonNativeLifecycleAction.OPEN_DISPUTE) return null;
    const normalized = reason?.trim() ?? "";
    if (normalized.length < 3 || normalized.length > 2_000) {
      throw new BadRequestException(
        "Dispute reason must contain between 3 and 2000 characters",
      );
    }
    return normalized;
  }

  private assertNativeTonDeal(deal: Deal): void {
    if (
      deal.settlementNetwork !== SettlementNetwork.TON ||
      deal.settlementMode !== SettlementMode.NATIVE ||
      deal.settlementAsset !== SettlementAsset.TON_NATIVE ||
      !deal.fundedAt
    ) {
      throw new BadRequestException("Deal is not a funded native TON escrow");
    }
  }

  private attachPreparation(
    intent: TonNativeLifecycleIntent,
    preparation: TonNativeEscrowPreparation,
    validForSeconds: number,
  ): TonNativeLifecycleIntent {
    return Object.assign(intent, {
      escrowAddress: preparation.escrowAddress,
      network: preparation.network,
      validForSeconds,
    });
  }
}

function queryIdFromUuid(value: string): bigint {
  const digest = createHash("sha256").update(value).digest("hex");
  const queryId = BigInt(`0x${digest.slice(0, 16)}`);
  return queryId === 0n ? 1n : queryId;
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
