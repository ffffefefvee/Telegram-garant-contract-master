import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { MoneyLedgerEntry } from "../ops/entities/money-ledger-entry.entity";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { SettlementCircuitScope } from "../safety/entities/settlement-circuit-breaker.entity";
import { SettlementIncidentKind } from "../safety/entities/settlement-circuit-breaker.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import { TonJettonLedgerReconciliation } from "./entities/ton-jetton-ledger-reconciliation.entity";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

export interface TonJettonLedgerReconciliationInput {
  preparationId: string;
  onChainAssetsAtomic: string;
  evidenceHash: string;
  actorId: string;
}

@Injectable()
export class TonJettonLedgerReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly circuitBreaker: SettlementCircuitBreakerService,
  ) {}

  async reconcile(input: TonJettonLedgerReconciliationInput): Promise<{
    onChainAssetsAtomic: string;
    ledgerLiabilitiesAtomic: string;
    deltaAtomic: string;
    breakerTripped: boolean;
  }> {
    validate(input);
    return this.dataSource.transaction((manager) =>
      this.reconcileLocked(manager, input),
    );
  }

  private async reconcileLocked(
    manager: EntityManager,
    input: TonJettonLedgerReconciliationInput,
  ) {
    const preparationRepo = manager.getRepository(TonJettonEscrowPreparation);
    let preparationQuery = preparationRepo
      .createQueryBuilder("preparation")
      .where("preparation.id = :id", { id: input.preparationId });
    if (this.dataSource.options.type === "postgres") {
      preparationQuery = preparationQuery.setLock("pessimistic_read");
    }
    const preparation = await preparationQuery.getOne();
    if (!preparation) throw new Error("JETTON_PREPARATION_NOT_FOUND");
    const escrowAccount = `escrow:ton:${preparation.dealId}`;
    const raw = await manager
      .getRepository(MoneyLedgerEntry)
      .createQueryBuilder("entry")
      .select(
        `COALESCE(SUM(CASE
          WHEN entry."creditAccount" = :escrowAccount THEN entry.amount
          WHEN entry."debitAccount" = :escrowAccount THEN -entry.amount
          ELSE 0 END), 0)`,
        "liability",
      )
      .where("entry.dealId = :dealId", { dealId: preparation.dealId })
      .andWhere("entry.currency = :currency", {
        currency: preparation.assetCode,
      })
      .setParameter("escrowAccount", escrowAccount)
      .getRawOne<{ liability: string }>();
    const liabilitiesAtomic = decimalToAtomic(
      raw?.liability ?? "0",
      preparation.assetDecimals,
    );
    const assets = BigInt(input.onChainAssetsAtomic);
    const liabilities = BigInt(liabilitiesAtomic);
    const delta = assets - liabilities;
    let breakerTripped: boolean;
    if (liabilities < 0n) {
      await this.circuitBreaker.tripSharedIncident(
        {
          incidentKind: SettlementIncidentKind.SHARED_LEDGER,
          reasonCode: "JETTON_NEGATIVE_ESCROW_LIABILITY",
          evidenceHash: input.evidenceHash,
          actorId: input.actorId,
        },
        manager,
      );
      breakerTripped = true;
    } else {
      const breaker = await this.circuitBreaker.tripOnDiscrepancy(
        {
          scope: SettlementCircuitScope.TON,
          assetCode: preparation.assetCode,
          assetsAtomic: input.onChainAssetsAtomic,
          liabilitiesAtomic,
          reasonCode: "JETTON_ASSETS_LIABILITIES_MISMATCH",
          evidenceHash: input.evidenceHash,
          actorId: input.actorId,
        },
        manager,
      );
      breakerTripped = breaker.tripped;
    }
    const snapshotRepo = manager.getRepository(TonJettonLedgerReconciliation);
    await snapshotRepo.save(
      snapshotRepo.create({
        preparationId: preparation.id,
        onChainAssetsAtomic: input.onChainAssetsAtomic,
        ledgerLiabilitiesAtomic: liabilitiesAtomic,
        deltaAtomic: delta.toString(),
        evidenceHash: input.evidenceHash,
        breakerTripped,
        actorId: input.actorId,
      }),
    );
    return {
      onChainAssetsAtomic: input.onChainAssetsAtomic,
      ledgerLiabilitiesAtomic: liabilitiesAtomic,
      deltaAtomic: delta.toString(),
      breakerTripped,
    };
  }
}

function decimalToAtomic(value: string, decimals: number): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("JETTON_LEDGER_BALANCE_INVALID");
  }
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new Error("JETTON_LEDGER_BALANCE_PRECISION_LOSS");
  }
  const atomic =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction.slice(0, decimals) || "0").padEnd(decimals, "0"));
  return (negative ? -atomic : atomic).toString();
}

function validate(input: TonJettonLedgerReconciliationInput): void {
  if (!UUID.test(input.preparationId))
    throw new Error("INVALID_JETTON_RECONCILIATION_ID");
  if (!/^(0|[1-9]\d{0,77})$/.test(input.onChainAssetsAtomic)) {
    throw new Error("INVALID_JETTON_RECONCILIATION_ASSETS");
  }
  if (!HASH.test(input.evidenceHash) || input.evidenceHash === "0".repeat(64)) {
    throw new Error("INVALID_JETTON_RECONCILIATION_EVIDENCE");
  }
  if (!/^[a-zA-Z0-9._:@-]{3,128}$/.test(input.actorId)) {
    throw new Error("INVALID_JETTON_RECONCILIATION_ACTOR");
  }
}
