import { generateKeyPairSync, randomUUID, sign } from "crypto";
import { beginCell } from "@ton/core";
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
  });

  it("versions immutable preparations and keeps exactly one active watch", async () => {
    const seeded = await seedDeal(dataSource);
    const firstInput = preparationInput(seeded.dealId);

    const first = await preparationService.prepare(firstInput);
    await expect(preparationService.prepare(firstInput)).resolves.toMatchObject(
      {
        status: "replayed",
      },
    );
    const second = await preparationService.prepare({
      ...firstInput,
      quoteId: randomUUID(),
      quoteHash: HASH("1"),
      configHash: HASH("2"),
      escrowAddress: ADDRESS("8"),
    });

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
    await expect(
      ingestion.rewindCursor({
        network: preparation.network,
        accountAddress: preparation.escrowAddress,
        toLt: null,
        toTransactionHash: null,
        toMasterchainSeqno: null,
        reasonCode: "BOUNDED_SOURCE_RESCAN",
        actorId: "operator.phase3",
      }),
    ).resolves.toMatchObject({ lastFinalizedLt: null });

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
    await ingestion.requeueManualReview({
      eventId: appended.event.id,
      reasonCode: "SOURCE_EVIDENCE_REVIEWED",
      actorId: "operator.phase3",
    });
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
      "ton_jetton_ledger_reconciliations"
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
  return { dealId, buyerId, sellerId };
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
    quoteId: randomUUID(),
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
