import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Cell } from "@ton/core";
import { DataSource, EntityManager } from "typeorm";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { SettlementCircuitScope } from "../safety/entities/settlement-circuit-breaker.entity";
import {
  TonJettonAction,
  TonJettonActionIntent,
} from "./entities/ton-jetton-action-intent.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import {
  TonJettonEscrowWatch,
  TonJettonEscrowWatchStatus,
} from "./entities/ton-jetton-escrow-watch.entity";

const OPCODE: Record<TonJettonAction, number> = {
  [TonJettonAction.MARK_DELIVERED]: 0x64656c76,
  [TonJettonAction.RELEASE]: 0x72656c73,
  [TonJettonAction.OPEN_DISPUTE]: 0x64737074,
  [TonJettonAction.REFUND_BUYER]: 0x72656664,
  [TonJettonAction.REFUND_AFTER_SELLER_TIMEOUT]: 0x73746d6f,
  [TonJettonAction.RELEASE_AFTER_BUYER_TIMEOUT]: 0x62746d6f,
  [TonJettonAction.RESOLVE]: 0x72736c76,
  [TonJettonAction.RECONCILE_ATTEMPT]: 0x72636e63,
  [TonJettonAction.RETRY_FAILED_LEGS]: 0x72747279,
  [TonJettonAction.FINALIZE_SETTLEMENT]: 0x666e6c7a,
};
const RAW_ADDRESS = /^-?\d+:[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-zA-Z0-9._:@-]{3,128}$/;

export interface TonJettonActionIntentInput {
  preparationId: string;
  action: TonJettonAction;
  requesterId: string;
  senderAddress: string;
  payload: string;
  nowSeconds: number;
}

export type TonJettonActionIntentResult =
  | { status: "created"; intent: TonJettonActionIntent }
  | { status: "replayed"; intent: TonJettonActionIntent };

interface ParsedActionBody {
  queryId: string;
  payloadHash: string;
  settlementId: string | null;
  buyerAwardAtomic: string | null;
  sellerAwardAtomic: string | null;
}

@Injectable()
export class TonJettonActionIntentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly circuitBreaker: SettlementCircuitBreakerService,
  ) {}

  async create(
    input: TonJettonActionIntentInput,
  ): Promise<TonJettonActionIntentResult> {
    if (!Object.values(TonJettonAction).includes(input.action)) {
      throw new BadRequestException("INVALID_JETTON_ACTION");
    }
    if (!IDENTIFIER.test(input.requesterId)) {
      throw new BadRequestException("INVALID_JETTON_ACTION_REQUESTER");
    }
    if (!RAW_ADDRESS.test(input.senderAddress)) {
      throw new BadRequestException("INVALID_JETTON_ACTION_SENDER");
    }
    if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1) {
      throw new BadRequestException("INVALID_JETTON_ACTION_TIME");
    }
    const parsed = parseActionBody(input.action, input.payload);
    return this.dataSource.transaction((manager) =>
      this.createLocked(manager, input, parsed),
    );
  }

  private async createLocked(
    manager: EntityManager,
    input: TonJettonActionIntentInput,
    parsed: ParsedActionBody,
  ): Promise<TonJettonActionIntentResult> {
    const preparation = await lockedBy(
      manager,
      TonJettonEscrowPreparation,
      "preparation.id = :id",
      { id: input.preparationId },
      this.dataSource.options.type === "postgres",
    );
    if (!preparation)
      throw new ConflictException("JETTON_PREPARATION_NOT_FOUND");
    const watch = await lockedBy(
      manager,
      TonJettonEscrowWatch,
      "watch.preparationId = :preparationId",
      { preparationId: preparation.id },
      this.dataSource.options.type === "postgres",
    );
    if (!watch) throw new ConflictException("JETTON_WATCH_NOT_FOUND");
    const nextStatus = assertActionAllowed(input, parsed, preparation, watch);

    if (movesFunds(input.action)) {
      await this.circuitBreaker.assertEgressAllowed(
        SettlementCircuitScope.TON,
        manager,
      );
    }

    const repository = manager.getRepository(TonJettonActionIntent);
    const existing = await repository.findOne({
      where: {
        preparationId: preparation.id,
        queryId: parsed.queryId,
      },
    });
    const candidate = {
      preparationId: preparation.id,
      dealId: preparation.dealId,
      action: input.action,
      expectedFromStatus: watch.status,
      expectedToStatus: nextStatus,
      requesterId: input.requesterId,
      senderAddress: input.senderAddress,
      queryId: parsed.queryId,
      payload: input.payload,
      payloadHash: parsed.payloadHash,
      settlementId: parsed.settlementId,
      buyerAwardAtomic: parsed.buyerAwardAtomic,
      sellerAwardAtomic: parsed.sellerAwardAtomic,
    };
    if (existing) {
      if (!sameIntent(existing, candidate)) {
        throw new ConflictException("JETTON_ACTION_QUERY_ID_CONFLICT");
      }
      return { status: "replayed", intent: existing };
    }
    const saved = await repository.save(repository.create(candidate));
    return { status: "created", intent: saved };
  }
}

function assertActionAllowed(
  input: TonJettonActionIntentInput,
  parsed: ParsedActionBody,
  preparation: TonJettonEscrowPreparation,
  watch: TonJettonEscrowWatch,
): TonJettonEscrowWatchStatus {
  const now = BigInt(input.nowSeconds);
  const delivery = BigInt(preparation.deliveryDeadline);
  const confirmation = BigInt(preparation.confirmationDeadline);
  const role = input.senderAddress;
  switch (input.action) {
    case TonJettonAction.MARK_DELIVERED:
      requireState(watch, TonJettonEscrowWatchStatus.FUNDED);
      requireSender(role, preparation.sellerAddress);
      if (now > delivery)
        throw new ConflictException("JETTON_DELIVERY_DEADLINE_PASSED");
      return TonJettonEscrowWatchStatus.DELIVERED;
    case TonJettonAction.OPEN_DISPUTE:
      requireAnyState(watch, [
        TonJettonEscrowWatchStatus.FUNDED,
        TonJettonEscrowWatchStatus.DELIVERED,
      ]);
      requireAnySender(role, [
        preparation.buyerAddress,
        preparation.sellerAddress,
      ]);
      if (
        (watch.status === TonJettonEscrowWatchStatus.FUNDED &&
          now > delivery) ||
        (watch.status === TonJettonEscrowWatchStatus.DELIVERED &&
          now > confirmation)
      ) {
        throw new ConflictException("JETTON_DISPUTE_DEADLINE_PASSED");
      }
      return TonJettonEscrowWatchStatus.DISPUTED;
    case TonJettonAction.RELEASE:
      requireState(watch, TonJettonEscrowWatchStatus.DELIVERED);
      requireSender(role, preparation.buyerAddress);
      if (now > confirmation) {
        throw new ConflictException("JETTON_CONFIRMATION_DEADLINE_PASSED");
      }
      return TonJettonEscrowWatchStatus.SETTLEMENT_PENDING;
    case TonJettonAction.REFUND_BUYER:
      requireAnyState(watch, [
        TonJettonEscrowWatchStatus.FUNDED,
        TonJettonEscrowWatchStatus.DELIVERED,
      ]);
      requireSender(role, preparation.sellerAddress);
      return TonJettonEscrowWatchStatus.SETTLEMENT_PENDING;
    case TonJettonAction.REFUND_AFTER_SELLER_TIMEOUT:
      requireState(watch, TonJettonEscrowWatchStatus.FUNDED);
      requireAnySender(role, [
        preparation.buyerAddress,
        preparation.sellerAddress,
      ]);
      if (now <= delivery)
        throw new ConflictException("JETTON_DELIVERY_DEADLINE_NOT_REACHED");
      return TonJettonEscrowWatchStatus.SETTLEMENT_PENDING;
    case TonJettonAction.RELEASE_AFTER_BUYER_TIMEOUT:
      requireState(watch, TonJettonEscrowWatchStatus.DELIVERED);
      requireAnySender(role, [
        preparation.buyerAddress,
        preparation.sellerAddress,
      ]);
      if (now <= confirmation) {
        throw new ConflictException("JETTON_CONFIRMATION_DEADLINE_NOT_REACHED");
      }
      return TonJettonEscrowWatchStatus.SETTLEMENT_PENDING;
    case TonJettonAction.RESOLVE:
      requireState(watch, TonJettonEscrowWatchStatus.DISPUTED);
      requireSender(role, preparation.arbitratorAddress);
      if (
        BigInt(parsed.buyerAwardAtomic!) +
          BigInt(parsed.sellerAwardAtomic!) +
          BigInt(preparation.platformFeeAtomic) !==
        BigInt(preparation.buyerTotalAtomic)
      ) {
        throw new ConflictException("JETTON_RESOLUTION_CONSERVATION_FAILED");
      }
      return TonJettonEscrowWatchStatus.SETTLEMENT_PENDING;
    case TonJettonAction.RECONCILE_ATTEMPT:
      requireState(watch, TonJettonEscrowWatchStatus.SETTLEMENT_PENDING);
      requireSender(role, preparation.reconciliationAddress);
      return TonJettonEscrowWatchStatus.RECOVERY_REQUIRED;
    case TonJettonAction.RETRY_FAILED_LEGS:
      requireState(watch, TonJettonEscrowWatchStatus.RECOVERY_REQUIRED);
      requireSender(role, preparation.reconciliationAddress);
      return TonJettonEscrowWatchStatus.SETTLEMENT_PENDING;
    case TonJettonAction.FINALIZE_SETTLEMENT:
      requireState(watch, TonJettonEscrowWatchStatus.SETTLEMENT_PENDING);
      requireSender(role, preparation.reconciliationAddress);
      return TonJettonEscrowWatchStatus.SETTLED_FINALIZED;
  }
}

function parseActionBody(
  action: TonJettonAction,
  payload: string,
): ParsedActionBody {
  let cell: Cell;
  try {
    const roots = Cell.fromBoc(Buffer.from(payload, "base64"));
    if (roots.length !== 1) throw new Error("root count");
    cell = roots[0];
  } catch {
    throw new BadRequestException("INVALID_JETTON_ACTION_PAYLOAD");
  }
  try {
    const slice = cell.beginParse();
    if (slice.loadUint(32) !== OPCODE[action]) {
      throw new Error("opcode");
    }
    const queryId = slice.loadUintBig(64);
    if (queryId < 1n) throw new Error("query id");
    let settlementId: bigint | null = null;
    let buyerAward: bigint | null = null;
    let sellerAward: bigint | null = null;
    if (
      [
        TonJettonAction.RELEASE,
        TonJettonAction.REFUND_BUYER,
        TonJettonAction.REFUND_AFTER_SELLER_TIMEOUT,
        TonJettonAction.RELEASE_AFTER_BUYER_TIMEOUT,
      ].includes(action)
    ) {
      settlementId = slice.loadUintBig(256);
      slice.loadUintBig(64);
      slice.loadUintBig(64);
      slice.loadUintBig(64);
    } else if (action === TonJettonAction.RESOLVE) {
      settlementId = slice.loadUintBig(256);
      buyerAward = slice.loadCoins();
      sellerAward = slice.loadCoins();
      slice.loadUintBig(64);
      slice.loadUintBig(64);
      slice.loadUintBig(64);
    } else if (action === TonJettonAction.RECONCILE_ATTEMPT) {
      settlementId = slice.loadUintBig(256);
      slice.loadUint(32);
      slice.loadUint(8);
      slice.loadUint(8);
      slice.loadUint(8);
      slice.loadUintBig(256);
    } else if (action === TonJettonAction.RETRY_FAILED_LEGS) {
      settlementId = slice.loadUintBig(256);
      slice.loadUint(32);
      slice.loadUintBig(64);
      slice.loadUintBig(64);
      slice.loadUintBig(64);
    } else if (action === TonJettonAction.FINALIZE_SETTLEMENT) {
      settlementId = slice.loadUintBig(256);
      slice.loadUint(32);
      slice.loadUintBig(256);
    }
    if (settlementId !== null && settlementId === 0n)
      throw new Error("settlement");
    slice.endParse();
    return {
      queryId: queryId.toString(),
      payloadHash: cell.hash().toString("hex"),
      settlementId: settlementId?.toString(16).padStart(64, "0") ?? null,
      buyerAwardAtomic: buyerAward?.toString() ?? null,
      sellerAwardAtomic: sellerAward?.toString() ?? null,
    };
  } catch {
    throw new BadRequestException("INVALID_JETTON_ACTION_PAYLOAD");
  }
}

function movesFunds(action: TonJettonAction): boolean {
  return [
    TonJettonAction.RELEASE,
    TonJettonAction.REFUND_BUYER,
    TonJettonAction.REFUND_AFTER_SELLER_TIMEOUT,
    TonJettonAction.RELEASE_AFTER_BUYER_TIMEOUT,
    TonJettonAction.RESOLVE,
    TonJettonAction.RETRY_FAILED_LEGS,
  ].includes(action);
}

function sameIntent(
  existing: TonJettonActionIntent,
  candidate: Omit<TonJettonActionIntent, "id" | "createdAt">,
): boolean {
  return Object.entries(candidate).every(
    ([key, value]) => existing[key as keyof TonJettonActionIntent] === value,
  );
}

function requireState(
  watch: TonJettonEscrowWatch,
  expected: TonJettonEscrowWatchStatus,
): void {
  if (watch.status !== expected)
    throw new ConflictException("JETTON_ACTION_WRONG_STATE");
}

function requireAnyState(
  watch: TonJettonEscrowWatch,
  expected: TonJettonEscrowWatchStatus[],
): void {
  if (!expected.includes(watch.status)) {
    throw new ConflictException("JETTON_ACTION_WRONG_STATE");
  }
}

function requireSender(actual: string, expected: string): void {
  if (actual !== expected)
    throw new ConflictException("JETTON_ACTION_UNAUTHORIZED");
}

function requireAnySender(actual: string, expected: string[]): void {
  if (!expected.includes(actual)) {
    throw new ConflictException("JETTON_ACTION_UNAUTHORIZED");
  }
}

async function lockedBy<T extends object>(
  manager: EntityManager,
  entity: new () => T,
  condition: string,
  parameters: Record<string, unknown>,
  postgres: boolean,
): Promise<T | null> {
  const alias = entity === TonJettonEscrowPreparation ? "preparation" : "watch";
  let query = manager
    .getRepository(entity)
    .createQueryBuilder(alias)
    .where(condition, parameters);
  if (postgres) query = query.setLock("pessimistic_write");
  return query.getOne();
}
