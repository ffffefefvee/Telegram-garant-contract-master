import { Injectable, Optional } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import {
  SettlementCircuitBreaker,
  SettlementCircuitBreakerAudit,
  SettlementCircuitScope,
  SettlementCircuitState,
  SettlementIncidentKind,
} from "./entities/settlement-circuit-breaker.entity";

const HASH = /^[0-9a-f]{64}$/;
const REASON = /^[A-Z0-9_]{3,64}$/;
const IDENTIFIER = /^[a-zA-Z0-9._:@-]{3,128}$/;
const ASSET = /^[A-Z0-9_-]{2,32}$/;

export class SettlementCircuitOpenError extends Error {
  readonly code = "SETTLEMENT_CIRCUIT_OPEN";

  constructor(
    readonly scope: SettlementCircuitScope,
    readonly operation: "funding" | "egress",
    reason: string,
  ) {
    super(`Settlement ${operation} blocked for ${scope}: ${reason}`);
    this.name = SettlementCircuitOpenError.name;
  }
}

export interface SettlementDiscrepancyInput {
  scope: SettlementCircuitScope.TON | SettlementCircuitScope.POLYGON;
  assetCode: string;
  assetsAtomic: string;
  liabilitiesAtomic: string;
  reasonCode: string;
  evidenceHash: string;
  actorId: string;
}

@Injectable()
export class SettlementCircuitBreakerService {
  constructor(@Optional() private readonly dataSource?: DataSource) {}

  async assertFundingAllowed(
    scope: SettlementCircuitScope.TON | SettlementCircuitScope.POLYGON,
    manager?: EntityManager,
  ): Promise<void> {
    return this.assertAllowed(scope, "funding", manager);
  }

  async assertEgressAllowed(
    scope: SettlementCircuitScope.TON | SettlementCircuitScope.POLYGON,
    manager?: EntityManager,
  ): Promise<void> {
    return this.assertAllowed(scope, "egress", manager);
  }

  async tripOnDiscrepancy(
    input: SettlementDiscrepancyInput,
    manager?: EntityManager,
  ): Promise<{ tripped: boolean; discrepancyAtomic: string }> {
    validateDiscrepancy(input);
    const assets = BigInt(input.assetsAtomic);
    const liabilities = BigInt(input.liabilitiesAtomic);
    const discrepancy =
      assets >= liabilities ? assets - liabilities : liabilities - assets;
    if (discrepancy === 0n) {
      return { tripped: false, discrepancyAtomic: "0" };
    }
    await this.withManager(manager, (tx) =>
      this.tripLocked(tx, {
        scope: input.scope,
        incidentKind: SettlementIncidentKind.RECONCILIATION_DISCREPANCY,
        reasonCode: input.reasonCode,
        assetCode: input.assetCode,
        discrepancyAtomic: discrepancy.toString(),
        evidenceHash: input.evidenceHash,
        actorId: input.actorId,
      }),
    );
    return { tripped: true, discrepancyAtomic: discrepancy.toString() };
  }

  async tripSharedIncident(
    input: {
      incidentKind:
        | SettlementIncidentKind.SHARED_LEDGER
        | SettlementIncidentKind.AUTHENTICATION
        | SettlementIncidentKind.GOVERNANCE;
      reasonCode: string;
      evidenceHash: string;
      actorId: string;
    },
    manager?: EntityManager,
  ): Promise<void> {
    validateCommon(input);
    await this.withManager(manager, (tx) =>
      this.tripLocked(tx, {
        scope: SettlementCircuitScope.GLOBAL,
        incidentKind: input.incidentKind,
        reasonCode: input.reasonCode,
        assetCode: null,
        discrepancyAtomic: null,
        evidenceHash: input.evidenceHash,
        actorId: input.actorId,
      }),
    );
  }

  async tripChainIncident(
    input: {
      scope: SettlementCircuitScope.TON | SettlementCircuitScope.POLYGON;
      incidentKind:
        | SettlementIncidentKind.SOURCE_DISAGREEMENT
        | SettlementIncidentKind.RECONCILIATION_DISCREPANCY;
      reasonCode: string;
      assetCode: string;
      evidenceHash: string;
      actorId: string;
    },
    manager?: EntityManager,
  ): Promise<void> {
    validateCommon(input);
    if (!ASSET.test(input.assetCode)) throw new Error("INVALID_BREAKER_ASSET");
    await this.withManager(manager, (tx) =>
      this.tripLocked(tx, {
        ...input,
        discrepancyAtomic: null,
      }),
    );
  }

  private async assertAllowed(
    scope: SettlementCircuitScope.TON | SettlementCircuitScope.POLYGON,
    operation: "funding" | "egress",
    manager?: EntityManager,
  ): Promise<void> {
    const repository = this.manager(manager).getRepository(
      SettlementCircuitBreaker,
    );
    const states = await repository.find({
      where: { scope: In([SettlementCircuitScope.GLOBAL, scope]) },
    });
    const global = states.find(
      (state) => state.scope === SettlementCircuitScope.GLOBAL,
    );
    const chain = states.find((state) => state.scope === scope);
    if (!global || !chain) {
      throw new SettlementCircuitOpenError(
        scope,
        operation,
        "BREAKER_STATE_UNAVAILABLE",
      );
    }
    const blocking = [global, chain].find(
      (state) => state.state !== SettlementCircuitState.CLOSED,
    );
    if (blocking) {
      throw new SettlementCircuitOpenError(
        blocking.scope,
        operation,
        blocking.reasonCode ?? "BREAKER_TRIPPED",
      );
    }
  }

  private async tripLocked(
    manager: EntityManager,
    input: {
      scope: SettlementCircuitScope;
      incidentKind: SettlementIncidentKind;
      reasonCode: string;
      assetCode: string | null;
      discrepancyAtomic: string | null;
      evidenceHash: string;
      actorId: string;
    },
  ): Promise<void> {
    validateCommon(input);
    const repository = manager.getRepository(SettlementCircuitBreaker);
    let query = repository
      .createQueryBuilder("breaker")
      .where("breaker.scope = :scope", { scope: input.scope });
    if (this.dataSource?.options.type === "postgres") {
      query = query.setLock("pessimistic_write");
    }
    const breaker = await query.getOne();
    if (!breaker) {
      throw new SettlementCircuitOpenError(
        input.scope,
        "egress",
        "BREAKER_STATE_UNAVAILABLE",
      );
    }
    const previousState = breaker.state;
    breaker.state = SettlementCircuitState.TRIPPED;
    breaker.incidentKind = input.incidentKind;
    breaker.reasonCode = input.reasonCode;
    breaker.assetCode = input.assetCode;
    breaker.discrepancyAtomic = input.discrepancyAtomic;
    breaker.evidenceHash = input.evidenceHash;
    breaker.trippedAt = breaker.trippedAt ?? new Date();
    breaker.revision += 1;
    await repository.save(breaker);
    const auditRepo = manager.getRepository(SettlementCircuitBreakerAudit);
    await auditRepo.save(
      auditRepo.create({
        scope: input.scope,
        previousState,
        nextState: SettlementCircuitState.TRIPPED,
        incidentKind: input.incidentKind,
        reasonCode: input.reasonCode,
        assetCode: input.assetCode,
        discrepancyAtomic: input.discrepancyAtomic,
        evidenceHash: input.evidenceHash,
        actorId: input.actorId,
        revision: breaker.revision,
      }),
    );
  }

  private manager(manager?: EntityManager): EntityManager {
    if (manager) return manager;
    if (!this.dataSource?.isInitialized) {
      throw new SettlementCircuitOpenError(
        SettlementCircuitScope.GLOBAL,
        "egress",
        "BREAKER_CONTROL_PLANE_UNAVAILABLE",
      );
    }
    return this.dataSource.manager;
  }

  private async withManager<T>(
    manager: EntityManager | undefined,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (manager) return work(manager);
    if (!this.dataSource?.isInitialized) {
      throw new SettlementCircuitOpenError(
        SettlementCircuitScope.GLOBAL,
        "egress",
        "BREAKER_CONTROL_PLANE_UNAVAILABLE",
      );
    }
    return this.dataSource.transaction(work);
  }
}

function validateDiscrepancy(input: SettlementDiscrepancyInput): void {
  validateCommon(input);
  if (!ASSET.test(input.assetCode)) throw new Error("INVALID_BREAKER_ASSET");
  for (const value of [input.assetsAtomic, input.liabilitiesAtomic]) {
    if (!/^(0|[1-9]\d{0,77})$/.test(value)) {
      throw new Error("INVALID_BREAKER_BALANCE");
    }
  }
}

function validateCommon(input: {
  reasonCode: string;
  evidenceHash: string;
  actorId: string;
}): void {
  if (!REASON.test(input.reasonCode)) throw new Error("INVALID_BREAKER_REASON");
  if (!HASH.test(input.evidenceHash) || input.evidenceHash === "0".repeat(64)) {
    throw new Error("INVALID_BREAKER_EVIDENCE_HASH");
  }
  if (!IDENTIFIER.test(input.actorId)) throw new Error("INVALID_BREAKER_ACTOR");
}
