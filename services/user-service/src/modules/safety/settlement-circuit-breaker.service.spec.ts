import {
  SettlementCircuitBreaker,
  SettlementCircuitBreakerAudit,
  SettlementCircuitScope,
  SettlementCircuitState,
  SettlementIncidentKind,
} from "./entities/settlement-circuit-breaker.entity";
import {
  SettlementCircuitBreakerService,
  SettlementCircuitOpenError,
} from "./settlement-circuit-breaker.service";

const EVIDENCE_HASH = "a".repeat(64);

function state(
  scope: SettlementCircuitScope,
  current = SettlementCircuitState.CLOSED,
): SettlementCircuitBreaker {
  return Object.assign(new SettlementCircuitBreaker(), {
    scope,
    state: current,
    incidentKind: null,
    reasonCode: null,
    assetCode: null,
    discrepancyAtomic: null,
    evidenceHash: null,
    trippedAt: null,
    revision: 0,
  });
}

function harness(states: SettlementCircuitBreaker[]) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ["where", "setLock"]) {
    query[method] = jest.fn(() => query);
  }
  query.getOne = jest.fn(async () => states[0] ?? null);
  const breakerRepo = {
    find: jest.fn().mockResolvedValue(states),
    createQueryBuilder: jest.fn(() => query),
    save: jest.fn(async (value) => value),
  };
  const auditRepo = {
    create: jest.fn((value) =>
      Object.assign(new SettlementCircuitBreakerAudit(), value),
    ),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === SettlementCircuitBreaker) return breakerRepo;
      if (entity === SettlementCircuitBreakerAudit) return auditRepo;
      throw new Error("unexpected repository");
    }),
  };
  const dataSource = { options: { type: "postgres" } };
  return {
    service: new SettlementCircuitBreakerService(dataSource as never),
    manager: manager as never,
    query,
    breakerRepo,
    auditRepo,
  };
}

describe("SettlementCircuitBreakerService", () => {
  it("allows a chain only when both its chain and global circuits are closed", async () => {
    const h = harness([
      state(SettlementCircuitScope.GLOBAL),
      state(SettlementCircuitScope.TON),
    ]);

    await expect(
      h.service.assertFundingAllowed(SettlementCircuitScope.TON, h.manager),
    ).resolves.toBeUndefined();
    await expect(
      h.service.assertEgressAllowed(SettlementCircuitScope.TON, h.manager),
    ).resolves.toBeUndefined();
  });

  it("fails closed when either durable circuit row is unavailable", async () => {
    const h = harness([state(SettlementCircuitScope.TON)]);

    await expect(
      h.service.assertFundingAllowed(SettlementCircuitScope.TON, h.manager),
    ).rejects.toBeInstanceOf(SettlementCircuitOpenError);
  });

  it("blocks only the affected chain for a chain discrepancy", async () => {
    const ton = state(
      SettlementCircuitScope.TON,
      SettlementCircuitState.TRIPPED,
    );
    ton.reasonCode = "ONE_UNIT_MISMATCH";
    const h = harness([
      state(SettlementCircuitScope.GLOBAL),
      ton,
      state(SettlementCircuitScope.POLYGON),
    ]);

    await expect(
      h.service.assertEgressAllowed(SettlementCircuitScope.TON, h.manager),
    ).rejects.toThrow("ONE_UNIT_MISMATCH");
    await expect(
      h.service.assertEgressAllowed(SettlementCircuitScope.POLYGON, h.manager),
    ).resolves.toBeUndefined();
  });

  it("detects and durably trips on a discrepancy of one atomic unit", async () => {
    const breaker = state(SettlementCircuitScope.TON);
    const h = harness([breaker]);

    await expect(
      h.service.tripOnDiscrepancy(
        {
          scope: SettlementCircuitScope.TON,
          assetCode: "USDT-TON",
          assetsAtomic: "5000000",
          liabilitiesAtomic: "4999999",
          reasonCode: "ONE_UNIT_MISMATCH",
          evidenceHash: EVIDENCE_HASH,
          actorId: "reconciliation.worker",
        },
        h.manager,
      ),
    ).resolves.toEqual({ tripped: true, discrepancyAtomic: "1" });
    expect(h.query.setLock).toHaveBeenCalledWith("pessimistic_write");
    expect(breaker).toEqual(
      expect.objectContaining({
        state: SettlementCircuitState.TRIPPED,
        discrepancyAtomic: "1",
        revision: 1,
      }),
    );
    expect(h.auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        previousState: SettlementCircuitState.CLOSED,
        nextState: SettlementCircuitState.TRIPPED,
        discrepancyAtomic: "1",
      }),
    );
  });

  it("does not mutate a breaker when assets exactly equal liabilities", async () => {
    const h = harness([state(SettlementCircuitScope.TON)]);

    await expect(
      h.service.tripOnDiscrepancy(
        {
          scope: SettlementCircuitScope.TON,
          assetCode: "USDT-TON",
          assetsAtomic: "5000000",
          liabilitiesAtomic: "5000000",
          reasonCode: "RECONCILIATION_MISMATCH",
          evidenceHash: EVIDENCE_HASH,
          actorId: "reconciliation.worker",
        },
        h.manager,
      ),
    ).resolves.toEqual({ tripped: false, discrepancyAtomic: "0" });
    expect(h.breakerRepo.save).not.toHaveBeenCalled();
    expect(h.auditRepo.save).not.toHaveBeenCalled();
  });

  it("routes shared ledger incidents to the global circuit", async () => {
    const global = state(SettlementCircuitScope.GLOBAL);
    const h = harness([global]);

    await h.service.tripSharedIncident(
      {
        incidentKind: SettlementIncidentKind.SHARED_LEDGER,
        reasonCode: "LEDGER_INVARIANT_FAILED",
        evidenceHash: EVIDENCE_HASH,
        actorId: "ledger.monitor",
      },
      h.manager,
    );

    expect(global.state).toBe(SettlementCircuitState.TRIPPED);
    expect(global.incidentKind).toBe(SettlementIncidentKind.SHARED_LEDGER);
  });

  it("trips only the affected chain when independent sources disagree", async () => {
    const ton = state(SettlementCircuitScope.TON);
    const h = harness([ton]);

    await h.service.tripChainIncident(
      {
        scope: SettlementCircuitScope.TON,
        incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
        reasonCode: "JETTON_SOURCE_DISAGREEMENT",
        assetCode: "USDT-TON",
        evidenceHash: EVIDENCE_HASH,
        actorId: "ton-jetton.application",
      },
      h.manager,
    );

    expect(ton).toEqual(
      expect.objectContaining({
        state: SettlementCircuitState.TRIPPED,
        incidentKind: SettlementIncidentKind.SOURCE_DISAGREEMENT,
        discrepancyAtomic: null,
      }),
    );
  });
});
