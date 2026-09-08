import { MoneyLedgerEntry } from "../ops/entities/money-ledger-entry.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import { TonJettonLedgerReconciliation } from "./entities/ton-jetton-ledger-reconciliation.entity";
import { TonJettonLedgerReconciliationService } from "./ton-jetton-ledger-reconciliation.service";

const PREPARATION_ID = "11111111-1111-4111-8111-111111111111";

function chain<T>(terminal: () => Promise<T>) {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    "where",
    "andWhere",
    "setLock",
    "select",
    "setParameter",
  ]) {
    query[method] = jest.fn(() => query);
  }
  query.getOne = jest.fn(terminal);
  query.getRawOne = jest.fn(terminal);
  return query;
}

function harness(liability: string, tripped: boolean) {
  const preparation = Object.assign(new TonJettonEscrowPreparation(), {
    id: PREPARATION_ID,
    dealId: "22222222-2222-4222-8222-222222222222",
    assetCode: "USDT-TON",
    assetDecimals: 6,
  });
  const prepQuery = chain(async () => preparation);
  const ledgerQuery = chain(async () => ({ liability }));
  const preparationRepo = {
    createQueryBuilder: jest.fn(() => prepQuery),
  };
  const ledgerRepo = { createQueryBuilder: jest.fn(() => ledgerQuery) };
  const snapshotRepo = {
    create: jest.fn((value) =>
      Object.assign(new TonJettonLedgerReconciliation(), value),
    ),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === TonJettonEscrowPreparation) return preparationRepo;
      if (entity === MoneyLedgerEntry) return ledgerRepo;
      if (entity === TonJettonLedgerReconciliation) return snapshotRepo;
      throw new Error("unexpected repository");
    }),
  };
  const dataSource = {
    options: { type: "postgres" },
    transaction: jest.fn(async (handler) => handler(manager)),
  };
  const circuitBreaker = {
    tripOnDiscrepancy: jest.fn().mockResolvedValue({
      tripped,
      discrepancyAtomic: tripped ? "1" : "0",
    }),
    tripSharedIncident: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new TonJettonLedgerReconciliationService(
      dataSource as never,
      circuitBreaker as never,
    ),
    prepQuery,
    ledgerQuery,
    snapshotRepo,
    circuitBreaker,
  };
}

describe("TonJettonLedgerReconciliationService", () => {
  it("proves exact assets-equal-liabilities and appends the snapshot", async () => {
    const h = harness("5.000000000000000000", false);

    await expect(
      h.service.reconcile({
        preparationId: PREPARATION_ID,
        onChainAssetsAtomic: "5000000",
        evidenceHash: "a".repeat(64),
        actorId: "reconciliation.worker",
      }),
    ).resolves.toEqual({
      onChainAssetsAtomic: "5000000",
      ledgerLiabilitiesAtomic: "5000000",
      deltaAtomic: "0",
      breakerTripped: false,
    });
    expect(h.prepQuery.setLock).toHaveBeenCalledWith("pessimistic_read");
    expect(h.snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ deltaAtomic: "0", breakerTripped: false }),
    );
  });

  it("passes a one-unit mismatch to the TON circuit and records it", async () => {
    const h = harness("4.999999", true);

    await expect(
      h.service.reconcile({
        preparationId: PREPARATION_ID,
        onChainAssetsAtomic: "5000000",
        evidenceHash: "a".repeat(64),
        actorId: "reconciliation.worker",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ledgerLiabilitiesAtomic: "4999999",
        deltaAtomic: "1",
        breakerTripped: true,
      }),
    );
    expect(h.circuitBreaker.tripOnDiscrepancy).toHaveBeenCalledWith(
      expect.objectContaining({
        assetsAtomic: "5000000",
        liabilitiesAtomic: "4999999",
      }),
      expect.anything(),
    );
  });

  it("trips the global shared-ledger circuit for an impossible negative liability", async () => {
    const h = harness("-0.000001", false);

    await expect(
      h.service.reconcile({
        preparationId: PREPARATION_ID,
        onChainAssetsAtomic: "0",
        evidenceHash: "a".repeat(64),
        actorId: "reconciliation.worker",
      }),
    ).resolves.toEqual({
      onChainAssetsAtomic: "0",
      ledgerLiabilitiesAtomic: "-1",
      deltaAtomic: "1",
      breakerTripped: true,
    });
    expect(h.circuitBreaker.tripSharedIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: "JETTON_NEGATIVE_ESCROW_LIABILITY",
      }),
      expect.anything(),
    );
    expect(h.circuitBreaker.tripOnDiscrepancy).not.toHaveBeenCalled();
    expect(h.snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ breakerTripped: true }),
    );
  });
});
