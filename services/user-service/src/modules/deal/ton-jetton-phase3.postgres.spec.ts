import { generateKeyPairSync, randomUUID, sign } from "crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginCell } from "@ton/core";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Agent, fetch as undiciFetch, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { DataSource } from "typeorm";
import { databaseConfig } from "../../config/database";
import {
  commitTonVerificationEvidence,
  tonEvidenceApprovalSigningPayload,
  type TonEvidenceSignature,
  type TonThresholdApprovalPolicy,
  type TonVerificationEvidencePolicy,
} from "../escrow/adapters/ton-proof/ton-verification-evidence";
import { SettlementCircuitBreakerService } from "../safety/settlement-circuit-breaker.service";
import { AuditLogService } from "../ops/audit-log.service";
import { AuditLogEntry } from "../ops/entities/audit-log.entity";
import { PrivilegedIdentityService } from "../auth/privileged-identity.service";
import { SettlementCircuitScope } from "../safety/entities/settlement-circuit-breaker.entity";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { TonJettonAction } from "./entities/ton-jetton-action-intent.entity";
import {
  TonJettonChainEventKind,
  TonJettonChainEventOutcome,
} from "./entities/ton-jetton-chain-event.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import { TonJettonEscrowWatchStatus } from "./entities/ton-jetton-escrow-watch.entity";
import { TonJettonActionIntentService } from "./ton-jetton-action-intent.service";
import {
  TonJettonDurableIngestionService,
  TonJettonFinalizedEventInput,
} from "./ton-jetton-durable-ingestion.service";
import { TonJettonLedgerReconciliationService } from "./ton-jetton-ledger-reconciliation.service";
import { TonJettonRecoveryService } from "./ton-jetton-recovery.service";
import {
  TonJettonPreparationInput,
  TonJettonPreparationService,
} from "./ton-jetton-preparation.service";
import {
  applicationCommitment,
  TonJettonApplicationEvidenceVerifier,
  TonJettonPersistedApplicationEvidence,
  TonJettonTransactionalApplicationService,
} from "./ton-jetton-transactional-application.service";

const runPostgres = process.env.RUN_PHASE3_POSTGRES === "true";
const describePostgres = runPostgres ? describe : describe.skip;
const ADDRESS = (digit: string) => `0:${digit.repeat(64)}`;
const HASH = (digit: string) => digit.repeat(64);
const BUYER = ADDRESS("a");
const SELLER = ADDRESS("b");
const MASTER = ADDRESS("c");
const ARBITRATOR = ADDRESS("d");
const TREASURY = ADDRESS("e");
const INITIALIZER = ADDRESS("f");
const RECONCILIATION = ADDRESS("9");
const APPROVAL_KEYS = ["operator-a", "operator-b", "operator-c"].map(
  (signerId) => ({ signerId, ...generateKeyPairSync("ed25519") }),
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createMockIdp } = require("../../../scripts/mock-idp.js");
const RECOVERY_REQUESTER = {
  id: "11111111-1111-4111-8111-111111111111", role: "super_admin",
  jti: "jetton-request-jti", sid: "jetton-request-sid",
  scopes: ["garant:admin:recovery"],
};
const RECOVERY_APPROVER = {
  id: "22222222-2222-4222-8222-222222222222", role: "super_admin",
  jti: "jetton-approve-jti", sid: "jetton-approve-sid",
  scopes: ["garant:admin:recovery"],
};

interface SeededDeal {
  dealId: string;
  buyerId: string;
  sellerId: string;
}

describePostgres("Phase 3 Jetton PostgreSQL exit gate", () => {
  let dataSource: DataSource;
  let circuitBreaker: SettlementCircuitBreakerService;
  let preparationService: TonJettonPreparationService;
  let ingestion: TonJettonDurableIngestionService;
  let recovery: TonJettonRecoveryService;
  let application: TonJettonTransactionalApplicationService;
  let intents: TonJettonActionIntentService;
  let ledgerReconciliation: TonJettonLedgerReconciliationService;

  beforeAll(async () => {
    dataSource = new DataSource({
      ...databaseConfig,
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: "each" });
    circuitBreaker = new SettlementCircuitBreakerService(dataSource);
    preparationService = new TonJettonPreparationService(
      dataSource,
      circuitBreaker,
    );
    ingestion = new TonJettonDurableIngestionService(dataSource, 3);
    recovery = new TonJettonRecoveryService(dataSource,
      new AuditLogService(dataSource.getRepository(AuditLogEntry)));
    application = new TonJettonTransactionalApplicationService(
      dataSource,
      ingestion,
      new TonJettonApplicationEvidenceVerifier(),
      circuitBreaker,
    );
    intents = new TonJettonActionIntentService(dataSource, circuitBreaker);
    ledgerReconciliation = new TonJettonLedgerReconciliationService(
      dataSource,
      circuitBreaker,
    );
    await installBoundaryFailureFunction(dataSource);
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DROP FUNCTION IF EXISTS phase3_raise_write_boundary() CASCADE`,
      );
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  }, 30_000);

  it("versions immutable preparations and keeps exactly one active watch", async () => {
    const seeded = await seedDeal(dataSource);
    const firstInput = preparationInput(seeded.dealId);

    const first = await preparationService.prepare(firstInput);
    await expect(preparationService.prepare(firstInput)).resolves.toMatchObject(
      {
        status: "replayed",
      },
    );
    const secondInput = {
      ...firstInput,
      quoteVersion: 2,
      quoteId: randomUUID(),
      quoteHash: HASH("1"),
      configHash: HASH("2"),
      escrowAddress: ADDRESS("8"),
    };
    await bindSettlementQuote(dataSource, seeded, secondInput);
    const second = await preparationService.prepare(secondInput);

    expect(first.preparation.version).toBe(1);
    expect(second.preparation.version).toBe(2);
    expect(second.preparation.previousPreparationId).toBe(first.preparation.id);
    const watches = await dataSource.query(
      `SELECT "preparationId", status FROM "ton_jetton_escrow_watches"
       WHERE "dealId" = $1 ORDER BY "createdAt"`,
      [seeded.dealId],
    );
    expect(watches).toEqual([
      expect.objectContaining({
        preparationId: first.preparation.id,
        status: TonJettonEscrowWatchStatus.SUPERSEDED,
      }),
      expect.objectContaining({
        preparationId: second.preparation.id,
        status: TonJettonEscrowWatchStatus.AWAITING_FUNDING,
      }),
    ]);
    await expect(
      dataSource.query(
        `UPDATE "ton_jetton_escrow_preparations" SET "quoteHash" = $1 WHERE id = $2`,
        [HASH("3"), second.preparation.id],
      ),
    ).rejects.toThrow("immutable settlement evidence cannot be changed");
  });

  it("converges duplicate observations and recovers its cursor with immutable evidence", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (
      await preparationService.prepare(preparationInput(seeded.dealId))
    ).preparation;
    const observed = fundingEvent(preparation, "100", "1");

    await expect(
      ingestion.appendFinalizedEvent(observed),
    ).resolves.toMatchObject({
      status: "appended",
    });
    await expect(
      ingestion.appendFinalizedEvent(observed),
    ).resolves.toMatchObject({
      status: "replayed",
    });
    const rewindRequest = await recovery.requestCursorRewind({
        network: preparation.network,
        accountAddress: preparation.escrowAddress,
        toLt: null,
        toTransactionHash: null,
        toMasterchainSeqno: null,
        reasonCode: "BOUNDED_SOURCE_RESCAN",
      }, RECOVERY_REQUESTER);
    await expect(recovery.approveCursorRewind(rewindRequest.requestId, RECOVERY_REQUESTER))
      .rejects.toThrow("different super admin");
    await expect(recovery.approveCursorRewind(rewindRequest.requestId, RECOVERY_APPROVER))
      .resolves.toMatchObject({ cursor: { lastFinalizedLt: null } });
    await expect(recovery.approveCursorRewind(rewindRequest.requestId, RECOVERY_APPROVER))
      .rejects.toThrow("not pending");

    const [{ events, applications, recoveries }] = await dataSource.query(`
      SELECT
        (SELECT count(*)::int FROM "ton_jetton_chain_events") AS events,
        (SELECT count(*)::int FROM "ton_jetton_event_applications") AS applications,
        (SELECT count(*)::int FROM "ton_jetton_ingestion_cursor_checkpoints"
          WHERE kind = 'recovery') AS recoveries
    `);
    expect({ events, applications, recoveries }).toEqual({
      events: 1,
      applications: 1,
      recoveries: 1,
    });
    await expect(
      dataSource.query(`DELETE FROM "ton_jetton_chain_events"`),
    ).rejects.toThrow("immutable settlement evidence cannot be changed");
  });

  it("rejects a shared IdP session, missing recovery scope, and a cancelled cursor intent", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (await preparationService.prepare(preparationInput(seeded.dealId))).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "1"));
    const target = { network: preparation.network, accountAddress: preparation.escrowAddress,
      toLt: null, toTransactionHash: null, toMasterchainSeqno: null,
      reasonCode: "BOUNDED_SOURCE_RESCAN" };
    await expect(recovery.requestCursorRewind(target, { ...RECOVERY_REQUESTER, scopes: [] }))
      .rejects.toThrow("requires a super admin");
    const request = await recovery.requestCursorRewind(target, RECOVERY_REQUESTER);
    await expect(dataSource.query(`UPDATE "ton_jetton_recovery_requests"
      SET "reasonCode" = 'ALTERED_REASON' WHERE id = $1`, [request.requestId]))
      .rejects.toThrow("jetton recovery intent is immutable");
    await expect(dataSource.query(`DELETE FROM "ton_jetton_recovery_requests" WHERE id = $1`,
      [request.requestId])).rejects.toThrow("jetton recovery requests cannot be deleted");
    await expect(recovery.approveCursorRewind(request.requestId,
      { ...RECOVERY_APPROVER, sid: RECOVERY_REQUESTER.sid }))
      .rejects.toThrow("different super admin and IdP session");
    await expect(recovery.requestCursorRewind(target, RECOVERY_APPROVER))
      .rejects.toThrow("already awaits approval");
    await recovery.cancel(request.requestId, RECOVERY_APPROVER);
    await expect(recovery.approveCursorRewind(request.requestId, RECOVERY_APPROVER))
      .rejects.toThrow("not pending");
    const [{ recoveries }] = await dataSource.query(`SELECT count(*)::int AS recoveries
      FROM "ton_jetton_ingestion_cursor_checkpoints" WHERE kind = 'recovery'`);
    expect(recoveries).toBe(0);
  });

  it("rejects approval if a new finalized Jetton observation changes the cursor", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (await preparationService.prepare(preparationInput(seeded.dealId))).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "1"));
    const request = await recovery.requestCursorRewind({
      network: preparation.network, accountAddress: preparation.escrowAddress,
      toLt: null, toTransactionHash: null, toMasterchainSeqno: null,
      reasonCode: "BOUNDED_SOURCE_RESCAN",
    }, RECOVERY_REQUESTER);
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "101", "2"));
    await expect(recovery.approveCursorRewind(request.requestId, RECOVERY_APPROVER))
      .rejects.toThrow("changed after recovery was requested");
  });

  it("allows only one pending Jetton cursor request under concurrent operators", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (await preparationService.prepare(preparationInput(seeded.dealId))).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "1"));
    const target = { network: preparation.network, accountAddress: preparation.escrowAddress,
      toLt: null, toTransactionHash: null, toMasterchainSeqno: null,
      reasonCode: "BOUNDED_SOURCE_RESCAN" };
    const results = await Promise.allSettled([
      recovery.requestCursorRewind(target, RECOVERY_REQUESTER),
      recovery.requestCursorRewind(target, RECOVERY_APPROVER),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [{ pending }] = await dataSource.query(`SELECT count(*)::int AS pending
      FROM "ton_jetton_recovery_requests" WHERE status = 'pending'`);
    expect(pending).toBe(1);
  });

  it("expires a Jetton recovery intent before replacement without mutating the cursor", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (await preparationService.prepare(preparationInput(seeded.dealId))).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "1"));
    const target = { network: preparation.network, accountAddress: preparation.escrowAddress,
      toLt: null, toTransactionHash: null, toMasterchainSeqno: null,
      reasonCode: "BOUNDED_SOURCE_RESCAN" };
    const first = await recovery.requestCursorRewind(target, RECOVERY_REQUESTER);
    const clock = jest.spyOn(Date, "now").mockReturnValue(first.expiresAt.getTime() + 1);
    try {
      await expect(recovery.approveCursorRewind(first.requestId, RECOVERY_APPROVER))
        .rejects.toThrow("expired");
      const replacement = await recovery.requestCursorRewind(target, RECOVERY_APPROVER);
      expect(replacement.requestId).not.toBe(first.requestId);
    } finally {
      clock.mockRestore();
    }
    const [old] = await dataSource.query(`SELECT status FROM "ton_jetton_recovery_requests"
      WHERE id = $1`, [first.requestId]);
    expect(old.status).toBe("expired");
    const [cursor] = await dataSource.query(`SELECT "lastFinalizedLt" FROM
      "ton_jetton_ingestion_cursors" WHERE "network" = $1 AND "accountAddress" = $2`,
      [preparation.network, preparation.escrowAddress]);
    expect(cursor.lastFinalizedLt).toBe("100");
  });

  it("executes two-person recovery using two HTTPS mock-IdP assertions and a durable PostgreSQL request", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (await preparationService.prepare(preparationInput(seeded.dealId))).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "1"));
    const fixtureRoot = mkdtempSync(join(tmpdir(), "garant-jetton-drill-"));
    const fixture = createMockIdp({ port: 0, root: fixtureRoot });
    const dispatcher = new Agent({ connect: { ca: fixture.identity.cert } });
    const originalDispatcher = getGlobalDispatcher();
    const originalFetch = globalThis.fetch;
    try {
      await fixture.start();
      setGlobalDispatcher(dispatcher);
      globalThis.fetch = undiciFetch as unknown as typeof fetch;
      const base = fixture.issuer();
      const settings: Record<string, string> = {
        ADMIN_STEP_UP_ISSUER: base,
        ADMIN_STEP_UP_AUDIENCE: "garant-admin",
        ADMIN_STEP_UP_MAX_AGE_SECONDS: "300",
        ADMIN_STEP_UP_JWKS_URL: `${base}/jwks`,
        ADMIN_STEP_UP_JWKS_CACHE_SECONDS: "300",
        ADMIN_STEP_UP_INTROSPECTION_URL: `${base}/introspect`,
        ADMIN_STEP_UP_INTROSPECTION_TOKEN: fixture.identity.introspectionToken,
        ADMIN_STEP_UP_REQUIRED_SCOPE: "garant:admin:step-up",
        ADMIN_STEP_UP_REQUIRED_ACR: "urn:garant:acr:phishing-resistant",
        ADMIN_STEP_UP_IDP_TIMEOUT_MS: "2000",
      };
      const verifier = new PrivilegedIdentityService(
        { get: (key: string) => settings[key] } as ConfigService, new JwtService());
      const actor = async (email: string) => {
        const response = await fetch(`${base}/token`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: email, password: fixture.identity.passwords[email] }),
        });
        expect(response.status).toBe(200);
        const { access_token: assertion } = await response.json() as { access_token: string };
        const id = fixture.users[email].sub;
        const identity = await verifier.verify({ kind: "ADMIN", assertion, actorId: id });
        return { id, role: "super_admin", jti: identity.jti, sid: identity.sid,
          scopes: identity.scope };
      };
      const requester = await actor("recovery1@local.test");
      const approver = await actor("recovery2@local.test");
      expect(requester.id).not.toBe(approver.id);
      expect(requester.sid).not.toBe(approver.sid);
      const [before] = await dataSource.query(`SELECT count(*)::int AS entries FROM money_ledger_entries`);
      const startedAt = new Date();
      const request = await recovery.requestCursorRewind({
        network: preparation.network, accountAddress: preparation.escrowAddress,
        toLt: null, toTransactionHash: null, toMasterchainSeqno: null,
        reasonCode: "BOUNDED_SOURCE_RESCAN",
      }, requester);
      await expect(recovery.approveCursorRewind(request.requestId, requester))
        .rejects.toThrow("different super admin");
      await expect(recovery.approveCursorRewind(request.requestId, approver))
        .resolves.toMatchObject({ status: "executed", cursor: { lastFinalizedLt: null } });
      const endedAt = new Date();
      const [after] = await dataSource.query(`SELECT count(*)::int AS entries FROM money_ledger_entries`);
      expect(after.entries).toBe(before.entries);
      const [evidence] = await dataSource.query(`SELECT r.status,
        (SELECT count(*)::int FROM ton_jetton_ingestion_cursor_checkpoints WHERE kind = 'recovery') AS checkpoints,
        (SELECT count(*)::int FROM audit_log WHERE "aggregateType" = 'ton_jetton_recovery_request'
          AND "aggregateId" = $1::text) AS audits
        FROM ton_jetton_recovery_requests r WHERE r.id::text = $1::text`, [request.requestId]);
      expect(evidence).toMatchObject({ status: "executed", checkpoints: 1, audits: 2 });
      console.log(JSON.stringify({ drill: "jetton-two-person-local", startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(), recoveryMs: endedAt.getTime() - startedAt.getTime(),
        initialLedgerEntries: before.entries, finalLedgerEntries: after.entries,
        ledgerDelta: after.entries - before.entries, requestId: request.requestId,
        status: evidence.status, checkpoints: evidence.checkpoints, audits: evidence.audits }));
    } finally {
      globalThis.fetch = originalFetch;
      setGlobalDispatcher(originalDispatcher);
      await dispatcher.close();
      await new Promise<void>((resolveClose) => fixture.server.close(() => resolveClose()));
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("uses SKIP LOCKED so two workers apply two deals exactly once", async () => {
    const firstDeal = await seedDeal(dataSource);
    const secondDeal = await seedDeal(dataSource);
    const firstPreparation = (
      await preparationService.prepare(preparationInput(firstDeal.dealId, "1"))
    ).preparation;
    const secondPreparation = (
      await preparationService.prepare(preparationInput(secondDeal.dealId, "2"))
    ).preparation;
    await ingestion.appendFinalizedEvent(
      fundingEvent(firstPreparation, "100", "3"),
    );
    await ingestion.appendFinalizedEvent(
      fundingEvent(secondPreparation, "100", "4"),
    );

    const results = await Promise.all([
      application.applyNext(),
      application.applyNext(),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "applied",
      "applied",
    ]);
    const [{ applied, ledger, fundedDeals }] = await dataSource.query(`
      SELECT
        (SELECT count(*)::int FROM "ton_jetton_event_applications"
          WHERE status = 'applied') AS applied,
        (SELECT count(*)::int FROM "money_ledger_entries"
          WHERE "entryType" = 'jetton_escrow_funded') AS ledger,
        (SELECT count(*)::int FROM deals
          WHERE status = 'in_progress' AND funded_at IS NOT NULL) AS "fundedDeals"
    `);
    expect({ applied, ledger, fundedDeals }).toEqual({
      applied: 2,
      ledger: 2,
      fundedDeals: 2,
    });
  });

  it.each([
    ["money_ledger_entries", "INSERT", false],
    ["deals", "UPDATE", false],
    ["ton_jetton_escrow_watches", "UPDATE", false],
    ["ton_jetton_event_applications", "UPDATE", true],
  ] as const)(
    "rolls back every funding write when %s fails",
    async (table, operation, appliedOnly) => {
      const seeded = await seedDeal(dataSource);
      const preparation = (
        await preparationService.prepare(preparationInput(seeded.dealId))
      ).preparation;
      await ingestion.appendFinalizedEvent(
        fundingEvent(preparation, "100", "5"),
      );
      await addBoundaryTrigger(dataSource, table, operation, appliedOnly);
      try {
        await expect(application.applyNext()).resolves.toMatchObject({
          status: "retry_pending",
          attempts: 1,
        });
      } finally {
        await dropBoundaryTrigger(dataSource, table);
      }
      const [state] = await dataSource.query(
        `SELECT
          (SELECT count(*)::int FROM "money_ledger_entries") AS ledger,
          (SELECT status::text FROM deals WHERE id = $1) AS deal,
          (SELECT status FROM "ton_jetton_escrow_watches" WHERE "dealId" = $1) AS watch,
          (SELECT "appliedAt" FROM "ton_jetton_event_applications" LIMIT 1) AS "appliedAt"`,
        [seeded.dealId],
      );
      expect(state).toEqual({
        ledger: 0,
        deal: "pending_payment",
        watch: TonJettonEscrowWatchStatus.AWAITING_FUNDING,
        appliedAt: null,
      });
    },
    30_000,
  );

  it("rolls back deal and watch changes when action-intent consumption crashes", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (
      await preparationService.prepare(preparationInput(seeded.dealId))
    ).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "6"));
    await application.applyNext();
    const intent = (
      await intents.create({
        preparationId: preparation.id,
        action: TonJettonAction.MARK_DELIVERED,
        requesterId: "seller.phase3",
        senderAddress: preparation.sellerAddress,
        payload: markDeliveredPayload(101n),
        nowSeconds: 2_100_000_150,
      })
    ).intent;
    await ingestion.appendFinalizedEvent(
      lifecycleEvent(
        preparation,
        TonJettonChainEventKind.MARK_DELIVERED,
        "101",
        "7",
        intent.id,
      ),
    );
    await addBoundaryTrigger(
      dataSource,
      "ton_jetton_action_intent_consumptions",
      "INSERT",
      false,
    );
    try {
      await expect(application.applyNext()).resolves.toMatchObject({
        status: "retry_pending",
      });
    } finally {
      await dropBoundaryTrigger(
        dataSource,
        "ton_jetton_action_intent_consumptions",
      );
    }
    const [state] = await dataSource.query(
      `SELECT
        (SELECT status::text FROM deals WHERE id = $1) AS deal,
        (SELECT status FROM "ton_jetton_escrow_watches" WHERE "dealId" = $1) AS watch,
        (SELECT count(*)::int FROM "ton_jetton_action_intent_consumptions") AS consumptions`,
      [seeded.dealId],
    );
    expect(state).toEqual({
      deal: "in_progress",
      watch: TonJettonEscrowWatchStatus.FUNDED,
      consumptions: 0,
    });
  });

  it("stops source disagreement for manual review and trips only the TON circuit", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (
      await preparationService.prepare(preparationInput(seeded.dealId))
    ).preparation;
    const observed = fundingEvent(preparation, "100", "8", false);
    const appended = await ingestion.appendFinalizedEvent(observed);

    await expect(application.applyNext()).resolves.toEqual({
      status: "manual_review",
      eventId: appended.event.id,
      attempts: 1,
    });
    await expect(
      circuitBreaker.assertFundingAllowed(SettlementCircuitScope.TON),
    ).rejects.toThrow("JETTON_PROOF_OR_SOURCE_DISAGREEMENT");
    await expect(
      circuitBreaker.assertFundingAllowed(SettlementCircuitScope.POLYGON),
    ).resolves.toBeUndefined();
    const requeueRequest = await recovery.requestRequeue(
      appended.event.id, "SOURCE_EVIDENCE_REVIEWED", RECOVERY_REQUESTER);
    await expect(recovery.approveRequeue(requeueRequest.requestId, RECOVERY_APPROVER))
      .resolves.toMatchObject({ status: "queued", replayRequiresReconciliation: true });
    const [{ reviews, ledger }] = await dataSource.query(`
      SELECT
        (SELECT count(*)::int FROM "ton_jetton_application_reviews") AS reviews,
        (SELECT count(*)::int FROM "money_ledger_entries") AS ledger
    `);
    expect({ reviews, ledger }).toEqual({ reviews: 1, ledger: 0 });
  });

  it("recovers partial payouts and proves ledger assets equal liabilities", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (
      await preparationService.prepare(preparationInput(seeded.dealId))
    ).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "1"));
    await application.applyNext();
    await dataSource.query(
      `UPDATE deals SET status = 'pending_confirmation' WHERE id = $1`,
      [seeded.dealId],
    );
    await dataSource.query(
      `UPDATE "ton_jetton_escrow_watches"
       SET status = 'recovery_required' WHERE "dealId" = $1`,
      [seeded.dealId],
    );

    await ingestion.appendFinalizedEvent(
      payoutEvent(preparation, "101", "2", "seller", "4900000", SELLER),
    );
    await application.applyNext();
    await expect(
      ledgerReconciliation.reconcile({
        preparationId: preparation.id,
        onChainAssetsAtomic: "100000",
        evidenceHash: HASH("3"),
        actorId: "reconciliation.phase3",
      }),
    ).resolves.toMatchObject({
      ledgerLiabilitiesAtomic: "100000",
      deltaAtomic: "0",
      breakerTripped: false,
    });

    await ingestion.appendFinalizedEvent(
      payoutEvent(preparation, "102", "4", "treasury", "100000", TREASURY),
    );
    await application.applyNext();
    await expect(
      ledgerReconciliation.reconcile({
        preparationId: preparation.id,
        onChainAssetsAtomic: "0",
        evidenceHash: HASH("5"),
        actorId: "reconciliation.phase3",
      }),
    ).resolves.toMatchObject({
      ledgerLiabilitiesAtomic: "0",
      deltaAtomic: "0",
      breakerTripped: false,
    });
    const [state] = await dataSource.query(
      `SELECT
        (SELECT count(*)::int FROM "money_ledger_entries") AS entries,
        (SELECT status FROM "ton_jetton_escrow_watches" WHERE "dealId" = $1) AS watch,
        (SELECT count(*)::int FROM "ton_jetton_ledger_reconciliations") AS snapshots`,
      [seeded.dealId],
    );
    expect(state).toEqual({
      entries: 3,
      watch: TonJettonEscrowWatchStatus.SETTLEMENT_PENDING,
      snapshots: 2,
    });
  });

  it("detects a one-unit reconciliation mismatch and blocks TON funding and egress", async () => {
    const seeded = await seedDeal(dataSource);
    const preparation = (
      await preparationService.prepare(preparationInput(seeded.dealId))
    ).preparation;
    await ingestion.appendFinalizedEvent(fundingEvent(preparation, "100", "6"));
    await application.applyNext();

    await expect(
      ledgerReconciliation.reconcile({
        preparationId: preparation.id,
        onChainAssetsAtomic: "4999999",
        evidenceHash: HASH("7"),
        actorId: "reconciliation.phase3",
      }),
    ).resolves.toMatchObject({
      deltaAtomic: "-1",
      breakerTripped: true,
    });
    await expect(
      circuitBreaker.assertFundingAllowed(SettlementCircuitScope.TON),
    ).rejects.toThrow("JETTON_ASSETS_LIABILITIES_MISMATCH");
    await expect(
      circuitBreaker.assertEgressAllowed(SettlementCircuitScope.TON),
    ).rejects.toThrow("JETTON_ASSETS_LIABILITIES_MISMATCH");
  });
});

async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(`
    TRUNCATE TABLE users, deals, "money_ledger_entries",
      "settlement_circuit_breaker_audit",
      "ton_jetton_ledger_reconciliations",
      "ton_jetton_ingestion_cursor_checkpoints",
      "ton_jetton_ingestion_cursors",
      "ton_jetton_recovery_requests"
    RESTART IDENTITY CASCADE
  `);
  await dataSource.query(`
    UPDATE "settlement_circuit_breakers"
    SET state = 'closed', "incidentKind" = NULL, "reasonCode" = NULL,
        "assetCode" = NULL, "discrepancyAtomic" = NULL,
        "evidenceHash" = NULL, "trippedAt" = NULL, revision = 0
  `);
}

async function seedDeal(dataSource: DataSource): Promise<SeededDeal> {
  const buyerId = randomUUID();
  const sellerId = randomUUID();
  const dealId = randomUUID();
  await dataSource.query(
    `INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)`,
    [buyerId, `${buyerId}@phase3.test`, sellerId, `${sellerId}@phase3.test`],
  );
  await dataSource.query(
    `INSERT INTO deals (
      id, deal_number, type, status, buyer_id, seller_id, amount, currency,
      description, settlement_network, settlement_chain_id, settlement_asset,
      asset_contract, settlement_mode, terms_version, terms_hash,
      buyer_wallet_address, seller_wallet_address
    ) VALUES (
      $1, $2, 'digital', 'pending_payment', $3, $4, 5, 'USDT',
      'Phase 3 PostgreSQL gate', 'ton', $5, 'ton_usdt', $6, 'native',
      3, $7, $8, $9
    )`,
    [
      dealId,
      `P3-${dealId}`,
      buyerId,
      sellerId,
      TonNetwork.TESTNET,
      MASTER,
      HASH("8"),
      BUYER,
      SELLER,
    ],
  );
  const seeded = { dealId, buyerId, sellerId };
  await bindSettlementQuote(dataSource, seeded, preparationInput(dealId));
  return seeded;
}

function preparationInput(
  dealId: string,
  discriminator = "0",
): TonJettonPreparationInput {
  return {
    dealId,
    network: TonNetwork.TESTNET,
    workchain: 0,
    codeHash: HASH("1"),
    configHash: HASH(discriminator === "0" ? "2" : discriminator),
    escrowAddress: ADDRESS(discriminator === "0" ? "7" : discriminator),
    stateInit: "te6ccg==",
    masterAddress: MASTER,
    walletCodeHash: HASH("3"),
    sealedWalletAddress: ADDRESS("6"),
    walletVerificationEvidenceHash: HASH("4"),
    termsVersion: 3,
    termsHash: HASH("8"),
    quoteVersion: 1,
    quoteId: dealId,
    quoteHash: HASH("5"),
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    arbitratorAddress: ARBITRATOR,
    treasuryAddress: TREASURY,
    initializerAddress: INITIALIZER,
    reconciliationAddress: RECONCILIATION,
    assetCode: "USDT-TON",
    assetDecimals: 6,
    buyerTotalAtomic: "5000000",
    sellerPayoutAtomic: "4900000",
    platformFeeAtomic: "100000",
    refundToBuyerAtomic: "4950000",
    refundFeeAtomic: "50000",
    fundingQueryId: "9001",
    fundingForwardPayloadHash: HASH("6"),
    fundingDeadline: "2100000100",
    deliveryDeadline: "2100000200",
    confirmationDeadline: "2100000300",
  };
}

async function bindSettlementQuote(
  dataSource: DataSource,
  seeded: SeededDeal,
  input: TonJettonPreparationInput,
): Promise<void> {
  await dataSource.query(
    `INSERT INTO settlement_quotes (
      id, deal_id, domain_version, version, terms_version, terms_hash, fee_model,
      network, chain_id, asset, asset_contract, decimals,
      amount_atomic, buyer_fee_atomic, seller_fee_atomic,
      total_funding_atomic, seller_receives_atomic,
      quoted_at, expires_at, hash
    ) VALUES (
      $1, $2, 1, $3, $4, $5, 'buyer_pays',
      'ton', $6, 'ton_usdt', $7, 6,
      $8, $9, '0', $10, $8,
      '2030-01-01T00:00:00Z', '2040-01-01T00:00:00Z', $11
    )`,
    [
      input.quoteId,
      seeded.dealId,
      input.quoteVersion,
      input.termsVersion,
      input.termsHash,
      input.network,
      input.masterAddress,
      input.sellerPayoutAtomic,
      (
        BigInt(input.buyerTotalAtomic) - BigInt(input.sellerPayoutAtomic)
      ).toString(),
      input.buyerTotalAtomic,
      input.quoteHash,
    ],
  );
  await dataSource.query(
    `INSERT INTO settlement_confirmations (
      deal_id, quote_id, party, user_id, domain_version,
      terms_version, terms_hash, quote_version, quote_hash,
      network, chain_id, asset
    ) VALUES
      ($1, $2, 'buyer', $3, 1, $5, $6, $7, $8, 'ton', $9, 'ton_usdt'),
      ($1, $2, 'seller', $4, 1, $5, $6, $7, $8, 'ton', $9, 'ton_usdt')`,
    [
      seeded.dealId,
      input.quoteId,
      seeded.buyerId,
      seeded.sellerId,
      input.termsVersion,
      input.termsHash,
      input.quoteVersion,
      input.quoteHash,
      input.network,
    ],
  );
  await dataSource.query(
    `UPDATE deals SET
      settlement_quote_id = $2,
      settlement_quote_version = $3,
      settlement_quote_hash = $4
    WHERE id = $1`,
    [seeded.dealId, input.quoteId, input.quoteVersion, input.quoteHash],
  );
}

function fundingEvent(
  preparation: TonJettonEscrowPreparation,
  lt: string,
  hashDigit: string,
  sourceAgreement = true,
): TonJettonFinalizedEventInput {
  return eventInput(
    preparation,
    TonJettonChainEventKind.FUNDING_CONFIRMED,
    lt,
    hashDigit,
    {
      amountAtomic: preparation.buyerTotalAtomic,
      independentSourceAgreementVerified: sourceAgreement,
    },
  );
}

function lifecycleEvent(
  preparation: TonJettonEscrowPreparation,
  kind: TonJettonChainEventKind,
  lt: string,
  hashDigit: string,
  actionIntentId: string,
): TonJettonFinalizedEventInput {
  return eventInput(preparation, kind, lt, hashDigit, { actionIntentId });
}

function payoutEvent(
  preparation: TonJettonEscrowPreparation,
  lt: string,
  hashDigit: string,
  leg: "buyer" | "seller" | "treasury",
  amountAtomic: string,
  destinationAddress: string,
): TonJettonFinalizedEventInput {
  return eventInput(
    preparation,
    TonJettonChainEventKind.PAYOUT_LEG_RECONCILED,
    lt,
    hashDigit,
    {
      settlementOutcome: "release",
      payoutLeg: leg,
      amountAtomic,
      destinationAddress,
    },
  );
}

function eventInput(
  preparation: TonJettonEscrowPreparation,
  kind: TonJettonChainEventKind,
  lt: string,
  hashDigit: string,
  overrides: {
    actionIntentId?: string | null;
    independentSourceAgreementVerified?: boolean;
    settlementOutcome?: "release" | "refund" | "resolution" | null;
    payoutLeg?: "buyer" | "seller" | "treasury" | null;
    amountAtomic?: string | null;
    destinationAddress?: string | null;
  } = {},
): TonJettonFinalizedEventInput {
  const transactionHash = HASH(hashDigit);
  const masterchainSeqno = 50 + Number(lt);
  const proofBundle = thresholdEvidence(
    Number(preparation.network),
    transactionHash,
    lt,
    masterchainSeqno,
    HASH("b"),
  );
  const base = {
    schemaVersion: 1 as const,
    preparationContentHash: preparation.contentHash,
    networkGlobalId: Number(preparation.network),
    accountAddress: preparation.escrowAddress,
    transactionLt: lt,
    transactionHash,
    eventKind: kind,
    proofVerificationSucceeded: true as const,
    reconciliationVerified: true as const,
    independentSourceAgreementVerified:
      overrides.independentSourceAgreementVerified ?? true,
    ...proofBundle,
    settlementOutcome: overrides.settlementOutcome ?? null,
    payoutLeg: overrides.payoutLeg ?? null,
    amountAtomic:
      overrides.amountAtomic ??
      (kind === TonJettonChainEventKind.FUNDING_CONFIRMED
        ? preparation.buyerTotalAtomic
        : null),
    destinationAddress: overrides.destinationAddress ?? null,
  };
  const applicationEvidence = {
    ...base,
    commitmentHash: applicationCommitment(base as never),
  } as TonJettonPersistedApplicationEvidence;
  return {
    preparationId: preparation.id,
    actionIntentId: overrides.actionIntentId ?? null,
    eventKind: kind,
    network: preparation.network,
    accountAddress: preparation.escrowAddress,
    transactionLt: lt,
    transactionHash,
    masterchainSeqno,
    transactionTime: 1_800_000_000 + Number(lt),
    messageHash: HASH("c"),
    outcome: TonJettonChainEventOutcome.ACCEPTED,
    reasonCode: "JETTON_EVENT_VERIFIED",
    correlationKey: preparation.dealId,
    evidence: { application: applicationEvidence },
  };
}

function thresholdEvidence(
  networkGlobalId: number,
  transactionHash: string,
  transactionLt: string,
  masterchainSeqno: number,
  proofCompositionHash: string,
) {
  const verificationEvidencePolicy: TonVerificationEvidencePolicy = {
    schemaVersion: 1,
    policyId: "ton-phase3-proof-policy-v1",
    verifierVersion: "ton-proof-kernel-v1",
    networkGlobalId,
    minimumMasterchainSeqno: 1,
    trustedNetworkConfigHash: HASH("1"),
    proofFixtureManifestHash: HASH("2"),
    independentReviewHash: HASH("3"),
  };
  const verificationEvidence = commitTonVerificationEvidence(
    {
      scope: "settlement_reconciliation",
      networkGlobalId,
      masterchainSeqno,
      masterchainRootHash: HASH("4"),
      masterchainFileHash: HASH("5"),
      subjectId: `jetton-event:${transactionHash}:${transactionLt}`,
      proofCompositionHash,
    },
    verificationEvidencePolicy,
  );
  const thresholdApprovalPolicy: TonThresholdApprovalPolicy = {
    schemaVersion: 1,
    policyId: "ton-phase3-approvers-v1",
    scope: "settlement_reconciliation",
    networkGlobalId,
    evidencePolicyHash: verificationEvidence.evidencePolicyHash,
    threshold: 2,
    signers: APPROVAL_KEYS.map((key) => ({
      signerId: key.signerId,
      enabled: true,
      publicKeySpkiDerBase64: key.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    })),
  };
  const payload = tonEvidenceApprovalSigningPayload(
    verificationEvidence,
    verificationEvidencePolicy,
    thresholdApprovalPolicy,
  );
  const thresholdSignatures: TonEvidenceSignature[] = APPROVAL_KEYS.slice(
    0,
    2,
  ).map((key) => ({
    signerId: key.signerId,
    algorithm: "ed25519",
    signatureBase64: sign(null, payload, key.privateKey).toString("base64"),
  }));
  return {
    verificationEvidence,
    verificationEvidencePolicy,
    thresholdApprovalPolicy,
    thresholdSignatures,
    verificationEvidenceHash: verificationEvidence.verificationEvidenceHash,
    proofCompositionHash,
  };
}

function markDeliveredPayload(queryId: bigint): string {
  return beginCell()
    .storeUint(0x64656c76, 32)
    .storeUint(queryId, 64)
    .endCell()
    .toBoc()
    .toString("base64");
}

async function installBoundaryFailureFunction(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(`
    CREATE OR REPLACE FUNCTION phase3_raise_write_boundary()
    RETURNS trigger AS $$
    BEGIN
      IF TG_NARGS = 1 AND TG_ARGV[0] = 'applied_only'
        AND NEW."status" <> 'applied' THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'PHASE3_SIMULATED_WRITE_CRASH';
    END;
    $$ LANGUAGE plpgsql
  `);
}

async function addBoundaryTrigger(
  dataSource: DataSource,
  table: string,
  operation: "INSERT" | "UPDATE",
  appliedOnly: boolean,
): Promise<void> {
  const argument = appliedOnly ? "('applied_only')" : "()";
  await dataSource.query(`
    CREATE TRIGGER phase3_test_write_boundary
    BEFORE ${operation} ON "${table}"
    FOR EACH ROW EXECUTE FUNCTION phase3_raise_write_boundary${argument}
  `);
}

async function dropBoundaryTrigger(
  dataSource: DataSource,
  table: string,
): Promise<void> {
  await dataSource.query(
    `DROP TRIGGER IF EXISTS phase3_test_write_boundary ON "${table}"`,
  );
}
