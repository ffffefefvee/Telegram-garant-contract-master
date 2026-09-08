import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { MoneyLedgerEntry } from "../ops/entities/money-ledger-entry.entity";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import {
  SettlementCircuitScope,
  SettlementIncidentKind,
} from "../safety/entities/settlement-circuit-breaker.entity";
import {
  approveTonVerificationEvidence,
  TonVerificationEvidenceError,
  type TonEvidenceSignature,
  type TonThresholdApprovalPolicy,
  type TonVerificationEvidence,
  type TonVerificationEvidencePolicy,
} from "../escrow/adapters/ton-proof/ton-verification-evidence";
import {
  TonJettonActionIntent,
  TonJettonActionIntentConsumption,
} from "./entities/ton-jetton-action-intent.entity";
import {
  TonJettonChainEvent,
  TonJettonChainEventKind,
} from "./entities/ton-jetton-chain-event.entity";
import { Deal } from "./entities/deal.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import {
  TonJettonEscrowWatch,
  TonJettonEscrowWatchStatus,
} from "./entities/ton-jetton-escrow-watch.entity";
import { DealStatus } from "./enums/deal.enum";
import {
  TonJettonApplyResult,
  TonJettonDurableIngestionService,
  tonJettonEvidenceHash,
} from "./ton-jetton-durable-ingestion.service";

const HASH = /^[0-9a-f]{64}$/;
const RAW_ADDRESS = /^-?\d+:[0-9a-f]{64}$/;

export class TonJettonApplicationEvidenceError extends Error {
  readonly code = "JETTON_SOURCE_DISAGREEMENT";

  constructor(message: string) {
    super(message);
    this.name = TonJettonApplicationEvidenceError.name;
  }
}

export type TonJettonSettlementOutcome = "release" | "refund" | "resolution";
export type TonJettonPayoutLeg = "buyer" | "seller" | "treasury";

export interface TonJettonApplicationDirective {
  eventKind: TonJettonChainEventKind;
  settlementOutcome: TonJettonSettlementOutcome | null;
  payoutLeg: TonJettonPayoutLeg | null;
  amountAtomic: string | null;
  destinationAddress: string | null;
  verificationEvidenceHash: string;
}

export interface TonJettonPersistedApplicationEvidence {
  schemaVersion: 1;
  preparationContentHash: string;
  networkGlobalId: number;
  accountAddress: string;
  transactionLt: string;
  transactionHash: string;
  eventKind: TonJettonChainEventKind;
  proofVerificationSucceeded: true;
  reconciliationVerified: true;
  independentSourceAgreementVerified: true;
  verificationEvidenceHash: string;
  proofCompositionHash: string;
  verificationEvidence: TonVerificationEvidence;
  verificationEvidencePolicy: TonVerificationEvidencePolicy;
  thresholdApprovalPolicy: TonThresholdApprovalPolicy;
  thresholdSignatures: TonEvidenceSignature[];
  settlementOutcome: TonJettonSettlementOutcome | null;
  payoutLeg: TonJettonPayoutLeg | null;
  amountAtomic: string | null;
  destinationAddress: string | null;
  commitmentHash: string;
}

/** Re-runs canonical evidence binding before any business write. */
@Injectable()
export class TonJettonApplicationEvidenceVerifier {
  verify(
    event: TonJettonChainEvent,
    preparation: TonJettonEscrowPreparation,
  ): TonJettonApplicationDirective {
    if (event.evidenceHash !== tonJettonEvidenceHash(event.evidence)) {
      throw new TonJettonApplicationEvidenceError(
        "JETTON_EVENT_EVIDENCE_HASH_MISMATCH",
      );
    }
    const value = event.evidence.application;
    if (!record(value)) {
      throw new TonJettonApplicationEvidenceError(
        "JETTON_APPLICATION_EVIDENCE_MISSING",
      );
    }
    requireExactKeys(value, [
      "schemaVersion",
      "preparationContentHash",
      "networkGlobalId",
      "accountAddress",
      "transactionLt",
      "transactionHash",
      "eventKind",
      "proofVerificationSucceeded",
      "reconciliationVerified",
      "independentSourceAgreementVerified",
      "verificationEvidenceHash",
      "proofCompositionHash",
      "verificationEvidence",
      "verificationEvidencePolicy",
      "thresholdApprovalPolicy",
      "thresholdSignatures",
      "settlementOutcome",
      "payoutLeg",
      "amountAtomic",
      "destinationAddress",
      "commitmentHash",
    ]);
    const proof = value as unknown as TonJettonPersistedApplicationEvidence;
    if (
      proof.schemaVersion !== 1 ||
      proof.preparationContentHash !== preparation.contentHash ||
      proof.networkGlobalId !== Number(preparation.network) ||
      proof.accountAddress !== event.accountAddress ||
      proof.accountAddress !== preparation.escrowAddress ||
      proof.transactionLt !== event.transactionLt ||
      proof.transactionHash !== event.transactionHash ||
      proof.eventKind !== event.eventKind ||
      proof.proofVerificationSucceeded !== true ||
      proof.reconciliationVerified !== true ||
      proof.independentSourceAgreementVerified !== true ||
      !validHash(proof.verificationEvidenceHash) ||
      !validHash(proof.proofCompositionHash)
    ) {
      throw new TonJettonApplicationEvidenceError(
        "JETTON_APPLICATION_PROOF_BINDING_INVALID",
      );
    }
    let approved;
    try {
      approved = approveTonVerificationEvidence(
        proof.verificationEvidence,
        proof.verificationEvidencePolicy,
        proof.thresholdApprovalPolicy,
        proof.thresholdSignatures,
      );
    } catch (error) {
      if (error instanceof TonVerificationEvidenceError) {
        throw new TonJettonApplicationEvidenceError(
          `JETTON_APPLICATION_THRESHOLD_EVIDENCE_INVALID: ${error.message}`,
        );
      }
      throw error;
    }
    const expectedSubjectId = `jetton-event:${event.transactionHash}:${event.transactionLt}`;
    if (
      approved.authorizationAllowed !== true ||
      approved.settlementAuthorized !== true ||
      approved.scope !== "settlement_reconciliation" ||
      approved.networkGlobalId !== proof.networkGlobalId ||
      approved.masterchainSeqno !== event.masterchainSeqno ||
      approved.subjectId !== expectedSubjectId ||
      approved.verificationEvidenceHash !== proof.verificationEvidenceHash ||
      approved.proofCompositionHash !== proof.proofCompositionHash
    ) {
      throw new TonJettonApplicationEvidenceError(
        "JETTON_APPLICATION_THRESHOLD_EVIDENCE_BINDING_INVALID",
      );
    }
    const commitment = applicationCommitment({
      ...proof,
      commitmentHash: undefined,
    });
    if (proof.commitmentHash !== commitment) {
      throw new TonJettonApplicationEvidenceError(
        "JETTON_APPLICATION_COMMITMENT_INVALID",
      );
    }
    validateMovementShape(proof);
    return {
      eventKind: proof.eventKind,
      settlementOutcome: proof.settlementOutcome,
      payoutLeg: proof.payoutLeg,
      amountAtomic: proof.amountAtomic,
      destinationAddress: proof.destinationAddress,
      verificationEvidenceHash: proof.verificationEvidenceHash,
    };
  }
}

/**
 * Phase 3 application worker. `TonJettonDurableIngestionService.applyNext`
 * owns the transaction and persists appliedAt only after this handler returns.
 */
@Injectable()
export class TonJettonTransactionalApplicationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ingestion: TonJettonDurableIngestionService,
    private readonly verifier: TonJettonApplicationEvidenceVerifier,
    private readonly circuitBreaker: SettlementCircuitBreakerService,
  ) {}

  applyNext(): Promise<TonJettonApplyResult> {
    return this.ingestion.applyNext((event, manager) =>
      this.applyLocked(event, manager),
    );
  }

  private async applyLocked(
    event: TonJettonChainEvent,
    manager: EntityManager,
  ): Promise<void> {
    const preparation = await lockOne(
      manager,
      TonJettonEscrowPreparation,
      "preparation",
      "preparation.id = :id",
      { id: event.preparationId },
      this.dataSource.options.type === "postgres",
    );
    if (!preparation) throw new Error("JETTON_PREPARATION_NOT_FOUND");
    const watch = await lockOne(
      manager,
      TonJettonEscrowWatch,
      "watch",
      "watch.preparationId = :preparationId",
      { preparationId: preparation.id },
      this.dataSource.options.type === "postgres",
    );
    if (!watch) throw new Error("JETTON_WATCH_NOT_FOUND");
    const deal = await lockOne(
      manager,
      Deal,
      "deal",
      "deal.id = :id",
      { id: preparation.dealId },
      this.dataSource.options.type === "postgres",
    );
    if (!deal || deal.id !== watch.dealId) {
      throw new Error("JETTON_DEAL_BINDING_MISMATCH");
    }
    if (
      event.accountAddress !== watch.accountAddress ||
      event.network !== watch.network
    ) {
      throw new Error("JETTON_EVENT_WATCH_BINDING_MISMATCH");
    }

    let directive: TonJettonApplicationDirective;
    try {
      directive = this.verifier.verify(event, preparation);
    } catch (error) {
      // The business transaction must roll back, but the chain stop must
      // survive. Omitting `manager` deliberately opens an independent tx.
      await this.circuitBreaker.tripChainIncident({
        scope: SettlementCircuitScope.TON,
        incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
        reasonCode: "JETTON_PROOF_OR_SOURCE_DISAGREEMENT",
        assetCode: preparation.assetCode,
        evidenceHash: validHash(event.evidenceHash)
          ? event.evidenceHash
          : event.transactionHash,
        actorId: "ton-jetton.application",
      });
      throw error;
    }
    const intent = await this.loadAndValidateIntent(
      event,
      preparation,
      manager,
    );

    if (directive.eventKind === TonJettonChainEventKind.FUNDING_CONFIRMED) {
      await this.circuitBreaker.assertFundingAllowed(
        SettlementCircuitScope.TON,
        manager,
      );
    }
    if (directive.eventKind === TonJettonChainEventKind.PAYOUT_LEG_RECONCILED) {
      await this.circuitBreaker.assertEgressAllowed(
        SettlementCircuitScope.TON,
        manager,
      );
    }

    // 3. Ledger posting, always before business status changes.
    await this.applyLedger(event, preparation, directive, intent, manager);

    // 4. Deal finite-state transition.
    const nextDealStatus = dealStatusAfter(
      event.eventKind,
      directive,
      deal.status,
    );
    if (nextDealStatus !== deal.status) {
      if (!deal.canTransitionTo(nextDealStatus)) {
        throw new Error("JETTON_DEAL_TRANSITION_INVALID");
      }
      deal.status = nextDealStatus;
      if (event.eventKind === TonJettonChainEventKind.FUNDING_CONFIRMED) {
        deal.fundedAt = deal.fundedAt ?? new Date();
      }
      await manager.getRepository(Deal).save(deal);
    }

    // 5. Immutable action consumption marker.
    if (intent && consumesIntent(event.eventKind)) {
      await this.consumeIntent(intent, event, manager);
    }

    // 6. Mutable watch projection.
    watch.status = watchStatusAfter(event.eventKind, directive, watch.status);
    watch.consecutiveFailures = 0;
    watch.lastError = null;
    watch.lastAppliedAt = new Date();
    await manager.getRepository(TonJettonEscrowWatch).save(watch);

    // 7. appliedAt is intentionally not written here. The ingestion service
    // writes it last after this handler returns successfully.
  }

  private async loadAndValidateIntent(
    event: TonJettonChainEvent,
    preparation: TonJettonEscrowPreparation,
    manager: EntityManager,
  ): Promise<TonJettonActionIntent | null> {
    const requiresIntent = [
      TonJettonChainEventKind.MARK_DELIVERED,
      TonJettonChainEventKind.OPEN_DISPUTE,
      TonJettonChainEventKind.SETTLEMENT_STARTED,
      TonJettonChainEventKind.SETTLEMENT_FINALIZED,
    ].includes(event.eventKind);
    if (!event.actionIntentId) {
      if (requiresIntent) throw new Error("JETTON_ACTION_INTENT_REQUIRED");
      return null;
    }
    const intent = await lockOne(
      manager,
      TonJettonActionIntent,
      "intent",
      "intent.id = :id",
      { id: event.actionIntentId },
      this.dataSource.options.type === "postgres",
    );
    if (
      !intent ||
      intent.preparationId !== preparation.id ||
      intent.dealId !== preparation.dealId
    ) {
      throw new Error("JETTON_ACTION_INTENT_BINDING_MISMATCH");
    }
    return intent;
  }

  private async consumeIntent(
    intent: TonJettonActionIntent,
    event: TonJettonChainEvent,
    manager: EntityManager,
  ): Promise<void> {
    const repository = manager.getRepository(TonJettonActionIntentConsumption);
    const existing = await repository.findOne({
      where: { intentId: intent.id },
    });
    if (existing) {
      if (existing.eventId !== event.id) {
        throw new Error("JETTON_ACTION_INTENT_ALREADY_CONSUMED");
      }
      return;
    }
    await repository.save(
      repository.create({ intentId: intent.id, eventId: event.id }),
    );
  }

  private async applyLedger(
    event: TonJettonChainEvent,
    preparation: TonJettonEscrowPreparation,
    directive: TonJettonApplicationDirective,
    intent: TonJettonActionIntent | null,
    manager: EntityManager,
  ): Promise<void> {
    if (event.eventKind === TonJettonChainEventKind.FUNDING_CONFIRMED) {
      if (directive.amountAtomic !== preparation.buyerTotalAtomic) {
        throw new Error("JETTON_FUNDING_LEDGER_AMOUNT_MISMATCH");
      }
      await insertLedger(manager, {
        dealId: preparation.dealId,
        idempotencyKey: `ton-jetton:${event.id}:fund`,
        debitAccount: "external_buyer_usdt_ton",
        creditAccount: `escrow:ton:${preparation.dealId}`,
        amount: atomicToDecimal(
          directive.amountAtomic,
          preparation.assetDecimals,
        ),
        currency: preparation.assetCode,
        entryType: "jetton_escrow_funded",
        metadata: ledgerMetadata(event, directive),
      });
      return;
    }
    if (event.eventKind !== TonJettonChainEventKind.PAYOUT_LEG_RECONCILED) {
      return;
    }
    const expected = expectedPayout(preparation, intent, directive);
    if (
      directive.amountAtomic !== expected.amountAtomic ||
      directive.destinationAddress !== expected.destinationAddress
    ) {
      throw new Error("JETTON_PAYOUT_LEDGER_BINDING_MISMATCH");
    }
    if (BigInt(expected.amountAtomic) === 0n) return;
    await insertLedger(manager, {
      dealId: preparation.dealId,
      idempotencyKey: `ton-jetton:${event.id}:${directive.payoutLeg}`,
      debitAccount: `escrow:ton:${preparation.dealId}`,
      creditAccount: expected.creditAccount,
      amount: atomicToDecimal(expected.amountAtomic, preparation.assetDecimals),
      currency: preparation.assetCode,
      entryType: "jetton_escrow_payout_reconciled",
      metadata: ledgerMetadata(event, directive),
    });
  }
}

export function applicationCommitment(
  value: Omit<TonJettonPersistedApplicationEvidence, "commitmentHash"> & {
    commitmentHash?: undefined;
  },
): string {
  return createHash("sha256")
    .update("TON_JETTON_DURABLE_APPLICATION_V1\0", "utf8")
    .update(stableJson(value), "utf8")
    .digest("hex");
}

async function lockOne<T extends object>(
  manager: EntityManager,
  entity: new () => T,
  alias: string,
  condition: string,
  parameters: Record<string, unknown>,
  postgres: boolean,
): Promise<T | null> {
  let query = manager
    .getRepository(entity)
    .createQueryBuilder(alias)
    .where(condition, parameters);
  if (postgres) query = query.setLock("pessimistic_write");
  return query.getOne();
}

async function insertLedger(
  manager: EntityManager,
  input: Pick<
    MoneyLedgerEntry,
    | "dealId"
    | "idempotencyKey"
    | "debitAccount"
    | "creditAccount"
    | "amount"
    | "currency"
    | "entryType"
    | "metadata"
  >,
): Promise<void> {
  const repository = manager.getRepository(MoneyLedgerEntry);
  const existing = await repository.findOne({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    const fields = [
      "dealId",
      "debitAccount",
      "creditAccount",
      "amount",
      "currency",
      "entryType",
    ] as const;
    if (fields.some((field) => existing[field] !== input[field])) {
      throw new Error("JETTON_LEDGER_IDEMPOTENCY_CONFLICT");
    }
    return;
  }
  await repository.save(repository.create({ ...input, paymentId: null }));
}

function expectedPayout(
  preparation: TonJettonEscrowPreparation,
  intent: TonJettonActionIntent | null,
  directive: TonJettonApplicationDirective,
): {
  amountAtomic: string;
  destinationAddress: string;
  creditAccount: string;
} {
  if (!directive.settlementOutcome || !directive.payoutLeg) {
    throw new Error("JETTON_PAYOUT_PLAN_MISSING");
  }
  if (directive.payoutLeg === "treasury") {
    return {
      amountAtomic:
        directive.settlementOutcome === "refund"
          ? preparation.refundFeeAtomic
          : preparation.platformFeeAtomic,
      destinationAddress: preparation.treasuryAddress,
      creditAccount: "platform_treasury_usdt_ton",
    };
  }
  if (
    directive.settlementOutcome === "release" &&
    directive.payoutLeg === "seller"
  ) {
    return {
      amountAtomic: preparation.sellerPayoutAtomic,
      destinationAddress: preparation.sellerAddress,
      creditAccount: "external_seller_usdt_ton",
    };
  }
  if (
    directive.settlementOutcome === "refund" &&
    directive.payoutLeg === "buyer"
  ) {
    return {
      amountAtomic: preparation.refundToBuyerAtomic,
      destinationAddress: preparation.buyerAddress,
      creditAccount: "external_buyer_usdt_ton",
    };
  }
  if (
    directive.settlementOutcome === "resolution" &&
    directive.payoutLeg === "buyer"
  ) {
    if (!intent?.buyerAwardAtomic)
      throw new Error("JETTON_RESOLUTION_PLAN_MISSING");
    return {
      amountAtomic: intent.buyerAwardAtomic,
      destinationAddress: preparation.buyerAddress,
      creditAccount: "external_buyer_usdt_ton",
    };
  }
  if (
    directive.settlementOutcome === "resolution" &&
    directive.payoutLeg === "seller"
  ) {
    if (!intent?.sellerAwardAtomic)
      throw new Error("JETTON_RESOLUTION_PLAN_MISSING");
    return {
      amountAtomic: intent.sellerAwardAtomic,
      destinationAddress: preparation.sellerAddress,
      creditAccount: "external_seller_usdt_ton",
    };
  }
  throw new Error("JETTON_PAYOUT_LEG_NOT_IN_PLAN");
}

function dealStatusAfter(
  kind: TonJettonChainEventKind,
  directive: TonJettonApplicationDirective,
  current: DealStatus,
): DealStatus {
  switch (kind) {
    case TonJettonChainEventKind.FUNDING_CONFIRMED:
      return DealStatus.IN_PROGRESS;
    case TonJettonChainEventKind.MARK_DELIVERED:
      return DealStatus.PENDING_CONFIRMATION;
    case TonJettonChainEventKind.OPEN_DISPUTE:
      return DealStatus.DISPUTED;
    case TonJettonChainEventKind.SETTLEMENT_FINALIZED:
      if (directive.settlementOutcome === "release")
        return DealStatus.COMPLETED;
      if (directive.settlementOutcome === "refund") return DealStatus.REFUNDED;
      if (directive.settlementOutcome === "resolution") {
        return DealStatus.DISPUTE_RESOLVED;
      }
      throw new Error("JETTON_SETTLEMENT_OUTCOME_MISSING");
    default:
      return current;
  }
}

function watchStatusAfter(
  kind: TonJettonChainEventKind,
  directive: TonJettonApplicationDirective,
  current: TonJettonEscrowWatchStatus,
): TonJettonEscrowWatchStatus {
  const expected: Partial<
    Record<TonJettonChainEventKind, TonJettonEscrowWatchStatus[]>
  > = {
    [TonJettonChainEventKind.FUNDING_CONFIRMED]: [
      TonJettonEscrowWatchStatus.AWAITING_FUNDING,
    ],
    [TonJettonChainEventKind.MARK_DELIVERED]: [
      TonJettonEscrowWatchStatus.FUNDED,
    ],
    [TonJettonChainEventKind.OPEN_DISPUTE]: [
      TonJettonEscrowWatchStatus.FUNDED,
      TonJettonEscrowWatchStatus.DELIVERED,
    ],
    [TonJettonChainEventKind.SETTLEMENT_STARTED]: [
      TonJettonEscrowWatchStatus.FUNDED,
      TonJettonEscrowWatchStatus.DELIVERED,
      TonJettonEscrowWatchStatus.DISPUTED,
    ],
    [TonJettonChainEventKind.PAYOUT_LEG_RECONCILED]: [
      TonJettonEscrowWatchStatus.SETTLEMENT_PENDING,
      TonJettonEscrowWatchStatus.RECOVERY_REQUIRED,
    ],
    [TonJettonChainEventKind.SETTLEMENT_FINALIZED]: [
      TonJettonEscrowWatchStatus.SETTLEMENT_PENDING,
    ],
    [TonJettonChainEventKind.RECOVERY_REQUIRED]: [
      TonJettonEscrowWatchStatus.SETTLEMENT_PENDING,
    ],
  };
  if (!expected[kind]?.includes(current)) {
    throw new Error("JETTON_WATCH_TRANSITION_INVALID");
  }
  switch (kind) {
    case TonJettonChainEventKind.FUNDING_CONFIRMED:
      return TonJettonEscrowWatchStatus.FUNDED;
    case TonJettonChainEventKind.MARK_DELIVERED:
      return TonJettonEscrowWatchStatus.DELIVERED;
    case TonJettonChainEventKind.OPEN_DISPUTE:
      return TonJettonEscrowWatchStatus.DISPUTED;
    case TonJettonChainEventKind.SETTLEMENT_STARTED:
    case TonJettonChainEventKind.PAYOUT_LEG_RECONCILED:
      return TonJettonEscrowWatchStatus.SETTLEMENT_PENDING;
    case TonJettonChainEventKind.RECOVERY_REQUIRED:
      return TonJettonEscrowWatchStatus.RECOVERY_REQUIRED;
    case TonJettonChainEventKind.SETTLEMENT_FINALIZED:
      if (!directive.settlementOutcome) {
        throw new Error("JETTON_SETTLEMENT_OUTCOME_MISSING");
      }
      return TonJettonEscrowWatchStatus.SETTLED_FINALIZED;
  }
}

function validateMovementShape(
  proof: TonJettonPersistedApplicationEvidence,
): void {
  const payout =
    proof.eventKind === TonJettonChainEventKind.PAYOUT_LEG_RECONCILED;
  const funding = proof.eventKind === TonJettonChainEventKind.FUNDING_CONFIRMED;
  if (payout) {
    if (
      !isOutcome(proof.settlementOutcome) ||
      !isLeg(proof.payoutLeg) ||
      !positiveAtomic(proof.amountAtomic) ||
      typeof proof.destinationAddress !== "string" ||
      !RAW_ADDRESS.test(proof.destinationAddress)
    ) {
      throw new TonJettonApplicationEvidenceError(
        "JETTON_PAYOUT_EVIDENCE_INVALID",
      );
    }
    return;
  }
  if (funding) {
    if (
      proof.settlementOutcome !== null ||
      proof.payoutLeg !== null ||
      !positiveAtomic(proof.amountAtomic) ||
      proof.destinationAddress !== null
    ) {
      throw new TonJettonApplicationEvidenceError(
        "JETTON_FUNDING_EVIDENCE_INVALID",
      );
    }
    return;
  }
  if (
    proof.payoutLeg !== null ||
    proof.amountAtomic !== null ||
    proof.destinationAddress !== null ||
    (proof.eventKind !== TonJettonChainEventKind.SETTLEMENT_STARTED &&
      proof.eventKind !== TonJettonChainEventKind.SETTLEMENT_FINALIZED &&
      proof.settlementOutcome !== null) ||
    ((proof.eventKind === TonJettonChainEventKind.SETTLEMENT_STARTED ||
      proof.eventKind === TonJettonChainEventKind.SETTLEMENT_FINALIZED) &&
      !isOutcome(proof.settlementOutcome))
  ) {
    throw new TonJettonApplicationEvidenceError(
      "JETTON_APPLICATION_MOVEMENT_INVALID",
    );
  }
}

function ledgerMetadata(
  event: TonJettonChainEvent,
  directive: TonJettonApplicationDirective,
): Record<string, unknown> {
  return {
    network: event.network,
    accountAddress: event.accountAddress,
    transactionLt: event.transactionLt,
    transactionHash: event.transactionHash,
    masterchainSeqno: event.masterchainSeqno,
    eventKind: event.eventKind,
    settlementOutcome: directive.settlementOutcome,
    payoutLeg: directive.payoutLeg,
    amountAtomic: directive.amountAtomic,
    verificationEvidenceHash: directive.verificationEvidenceHash,
  };
}

function atomicToDecimal(value: string | null, decimals: number): string {
  if (!positiveAtomic(value)) throw new Error("JETTON_LEDGER_AMOUNT_INVALID");
  const atomic = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function positiveAtomic(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d{0,77})$/.test(value) &&
    BigInt(value) > 0n
  );
}

function validHash(value: unknown): value is string {
  return (
    typeof value === "string" && HASH.test(value) && value !== "0".repeat(64)
  );
}

function isOutcome(value: unknown): value is TonJettonSettlementOutcome {
  return value === "release" || value === "refund" || value === "resolution";
}

function isLeg(value: unknown): value is TonJettonPayoutLeg {
  return value === "buyer" || value === "seller" || value === "treasury";
}

function consumesIntent(kind: TonJettonChainEventKind): boolean {
  return [
    TonJettonChainEventKind.MARK_DELIVERED,
    TonJettonChainEventKind.OPEN_DISPUTE,
    TonJettonChainEventKind.SETTLEMENT_STARTED,
    TonJettonChainEventKind.SETTLEMENT_FINALIZED,
  ].includes(kind);
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TonJettonApplicationEvidenceError(
      "JETTON_APPLICATION_EVIDENCE_SHAPE_INVALID",
    );
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
