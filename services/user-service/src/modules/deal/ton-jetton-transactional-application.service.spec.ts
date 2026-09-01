import { generateKeyPairSync, sign } from "crypto";
import { MoneyLedgerEntry } from "../ops/entities/money-ledger-entry.entity";
import {
  commitTonVerificationEvidence,
  tonEvidenceApprovalSigningPayload,
  type TonEvidenceSignature,
  type TonThresholdApprovalPolicy,
  type TonVerificationEvidencePolicy,
} from "../escrow/adapters/ton-proof/ton-verification-evidence";
import {
  TonJettonActionIntent,
  TonJettonActionIntentConsumption,
} from "./entities/ton-jetton-action-intent.entity";
import {
  TonJettonChainEvent,
  TonJettonChainEventKind,
  TonJettonChainEventOutcome,
} from "./entities/ton-jetton-chain-event.entity";
import { Deal } from "./entities/deal.entity";
import { TonJettonEscrowPreparation } from "./entities/ton-jetton-escrow-preparation.entity";
import {
  TonJettonEscrowWatch,
  TonJettonEscrowWatchStatus,
} from "./entities/ton-jetton-escrow-watch.entity";
import { DealStatus } from "./enums/deal.enum";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import {
  tonJettonEvidenceHash,
  TonJettonDurableIngestionService,
} from "./ton-jetton-durable-ingestion.service";
import {
  applicationCommitment,
  TonJettonApplicationEvidenceVerifier,
  TonJettonPersistedApplicationEvidence,
  TonJettonTransactionalApplicationService,
} from "./ton-jetton-transactional-application.service";

const PREPARATION_ID = "11111111-1111-4111-8111-111111111111";
const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = `0:${"1".repeat(64)}`;
const BUYER = `0:${"2".repeat(64)}`;
const SELLER = `0:${"3".repeat(64)}`;
const TREASURY = `0:${"4".repeat(64)}`;
const APPROVAL_KEYS = ["operator-a", "operator-b", "operator-c"].map(
  (signerId) => ({ signerId, ...generateKeyPairSync("ed25519") }),
);

function thresholdEvidence(
  transactionHash: string,
  transactionLt: string,
  masterchainSeqno: number,
  proofCompositionHash: string,
) {
  const verificationEvidencePolicy: TonVerificationEvidencePolicy = {
    schemaVersion: 1,
    policyId: "ton-phase3-proof-policy-v1",
    verifierVersion: "ton-proof-kernel-v1",
    networkGlobalId: -3,
    minimumMasterchainSeqno: 1,
    trustedNetworkConfigHash: "1".repeat(64),
    proofFixtureManifestHash: "2".repeat(64),
    independentReviewHash: "3".repeat(64),
  };
  const verificationEvidence = commitTonVerificationEvidence(
    {
      scope: "settlement_reconciliation",
      networkGlobalId: -3,
      masterchainSeqno,
      masterchainRootHash: "4".repeat(64),
      masterchainFileHash: "5".repeat(64),
      subjectId: `jetton-event:${transactionHash}:${transactionLt}`,
      proofCompositionHash,
    },
    verificationEvidencePolicy,
  );
  const thresholdApprovalPolicy: TonThresholdApprovalPolicy = {
    schemaVersion: 1,
    policyId: "ton-phase3-approvers-v1",
    scope: "settlement_reconciliation",
    networkGlobalId: -3,
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

function preparation(): TonJettonEscrowPreparation {
  return Object.assign(new TonJettonEscrowPreparation(), {
    id: PREPARATION_ID,
    dealId: DEAL_ID,
    version: 1,
    contentHash: "a".repeat(64),
    network: TonNetwork.TESTNET,
    escrowAddress: ACCOUNT,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    treasuryAddress: TREASURY,
    assetCode: "USDT-TON",
    assetDecimals: 6,
    buyerTotalAtomic: "5000000",
    sellerPayoutAtomic: "4900000",
    platformFeeAtomic: "100000",
    refundToBuyerAtomic: "4950000",
    refundFeeAtomic: "50000",
  });
}

function event(
  kind: TonJettonChainEventKind,
  movement: {
    settlementOutcome?: "release" | "refund" | "resolution" | null;
    payoutLeg?: "buyer" | "seller" | "treasury" | null;
    amountAtomic?: string | null;
    destinationAddress?: string | null;
  } = {},
): TonJettonChainEvent {
  const result = Object.assign(new TonJettonChainEvent(), {
    id: "33333333-3333-4333-8333-333333333333",
    preparationId: PREPARATION_ID,
    actionIntentId: null,
    eventKind: kind,
    network: TonNetwork.TESTNET,
    accountAddress: ACCOUNT,
    transactionLt: "100",
    transactionHash: "b".repeat(64),
    masterchainSeqno: 50,
    transactionTime: 1_800_000_000,
    messageHash: "c".repeat(64),
    outcome: TonJettonChainEventOutcome.ACCEPTED,
    reasonCode: "JETTON_EVENT_VERIFIED",
    correlationKey: DEAL_ID,
  });
  const proofBundle = thresholdEvidence(
    result.transactionHash,
    result.transactionLt,
    result.masterchainSeqno,
    "e".repeat(64),
  );
  const base: Omit<TonJettonPersistedApplicationEvidence, "commitmentHash"> = {
    schemaVersion: 1,
    preparationContentHash: preparation().contentHash,
    networkGlobalId: Number(TonNetwork.TESTNET),
    accountAddress: ACCOUNT,
    transactionLt: result.transactionLt,
    transactionHash: result.transactionHash,
    eventKind: kind,
    proofVerificationSucceeded: true,
    reconciliationVerified: true,
    independentSourceAgreementVerified: true,
    ...proofBundle,
    settlementOutcome: movement.settlementOutcome ?? null,
    payoutLeg: movement.payoutLeg ?? null,
    amountAtomic:
      movement.amountAtomic ??
      (kind === TonJettonChainEventKind.FUNDING_CONFIRMED ? "5000000" : null),
    destinationAddress: movement.destinationAddress ?? null,
  };
  const application: TonJettonPersistedApplicationEvidence = {
    ...base,
    commitmentHash: applicationCommitment(base),
  };
  result.evidence = { application };
  result.evidenceHash = tonJettonEvidenceHash(result.evidence);
  return result;
}

function queryReturning<T>(value: T) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ["where", "setLock"]) {
    query[method] = jest.fn(() => query);
  }
  query.getOne = jest.fn().mockResolvedValue(value);
  return query;
}

function applicationHarness(chainEvent: TonJettonChainEvent) {
  const prep = preparation();
  const watch = Object.assign(new TonJettonEscrowWatch(), {
    id: "watch-1",
    preparationId: prep.id,
    dealId: DEAL_ID,
    network: TonNetwork.TESTNET,
    accountAddress: ACCOUNT,
    status:
      chainEvent.eventKind === TonJettonChainEventKind.FUNDING_CONFIRMED
        ? TonJettonEscrowWatchStatus.AWAITING_FUNDING
        : TonJettonEscrowWatchStatus.RECOVERY_REQUIRED,
    consecutiveFailures: 2,
    lastError: "prior partial payout",
    lastAppliedAt: null,
  });
  const deal = Object.assign(new Deal(), {
    id: DEAL_ID,
    status:
      chainEvent.eventKind === TonJettonChainEventKind.FUNDING_CONFIRMED
        ? DealStatus.PENDING_PAYMENT
        : DealStatus.PENDING_CONFIRMATION,
    fundedAt: null,
  });
  const preparationRepo = {
    createQueryBuilder: jest.fn(() => queryReturning(prep)),
  };
  const watchRepo = {
    createQueryBuilder: jest.fn(() => queryReturning(watch)),
    save: jest.fn(async (value) => value),
  };
  const dealRepo = {
    createQueryBuilder: jest.fn(() => queryReturning(deal)),
    save: jest.fn(async (value) => value),
  };
  const ledgerRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => Object.assign(new MoneyLedgerEntry(), value)),
    save: jest.fn(async (value) => value),
  };
  const intentRepo = {
    createQueryBuilder: jest.fn(() => queryReturning(null)),
  };
  const consumptionRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) =>
      Object.assign(new TonJettonActionIntentConsumption(), value),
    ),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === TonJettonEscrowPreparation) return preparationRepo;
      if (entity === TonJettonEscrowWatch) return watchRepo;
      if (entity === Deal) return dealRepo;
      if (entity === MoneyLedgerEntry) return ledgerRepo;
      if (entity === TonJettonActionIntent) return intentRepo;
      if (entity === TonJettonActionIntentConsumption) return consumptionRepo;
      throw new Error(`unexpected repository ${String(entity)}`);
    }),
  };
  const ingestion = {
    applyNext: jest.fn(async (handler) => {
      await handler(chainEvent, manager);
      return { status: "applied", eventId: chainEvent.id };
    }),
  };
  const circuitBreaker = {
    assertFundingAllowed: jest.fn().mockResolvedValue(undefined),
    assertEgressAllowed: jest.fn().mockResolvedValue(undefined),
    tripChainIncident: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TonJettonTransactionalApplicationService(
    { options: { type: "postgres" } } as never,
    ingestion as unknown as TonJettonDurableIngestionService,
    new TonJettonApplicationEvidenceVerifier(),
    circuitBreaker as never,
  );
  return {
    service,
    prep,
    watch,
    deal,
    ledgerRepo,
    dealRepo,
    watchRepo,
    circuitBreaker,
  };
}

describe("TonJettonApplicationEvidenceVerifier", () => {
  const verifier = new TonJettonApplicationEvidenceVerifier();

  it("revalidates an exact immutable event/preparation proof commitment", () => {
    expect(
      verifier.verify(
        event(TonJettonChainEventKind.FUNDING_CONFIRMED),
        preparation(),
      ),
    ).toEqual(
      expect.objectContaining({
        eventKind: TonJettonChainEventKind.FUNDING_CONFIRMED,
        amountAtomic: "5000000",
      }),
    );
  });

  it("rejects evidence mutated after append", () => {
    const observed = event(TonJettonChainEventKind.FUNDING_CONFIRMED);
    (observed.evidence.application as Record<string, unknown>).amountAtomic =
      "5000001";

    expect(() => verifier.verify(observed, preparation())).toThrow(
      "JETTON_EVENT_EVIDENCE_HASH_MISMATCH",
    );
  });

  it("rejects a recomputed raw hash when the signed application commitment is stale", () => {
    const observed = event(TonJettonChainEventKind.FUNDING_CONFIRMED);
    (observed.evidence.application as Record<string, unknown>).amountAtomic =
      "5000001";
    observed.evidenceHash = tonJettonEvidenceHash(observed.evidence);

    expect(() => verifier.verify(observed, preparation())).toThrow(
      "JETTON_APPLICATION_COMMITMENT_INVALID",
    );
  });
});

describe("TonJettonTransactionalApplicationService", () => {
  it("posts funding before the deal/watch changes and checks the TON funding circuit", async () => {
    const h = applicationHarness(
      event(TonJettonChainEventKind.FUNDING_CONFIRMED),
    );

    await expect(h.service.applyNext()).resolves.toMatchObject({
      status: "applied",
    });

    expect(h.circuitBreaker.assertFundingAllowed).toHaveBeenCalledTimes(1);
    expect(h.ledgerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        debitAccount: "external_buyer_usdt_ton",
        creditAccount: `escrow:ton:${DEAL_ID}`,
        amount: "5",
        currency: "USDT-TON",
      }),
    );
    expect(h.deal.status).toBe(DealStatus.IN_PROGRESS);
    expect(h.deal.fundedAt).toBeInstanceOf(Date);
    expect(h.watch.status).toBe(TonJettonEscrowWatchStatus.FUNDED);
    expect(h.ledgerRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
      h.dealRepo.save.mock.invocationCallOrder[0],
    );
    expect(h.dealRepo.save.mock.invocationCallOrder[0]).toBeLessThan(
      h.watchRepo.save.mock.invocationCallOrder[0],
    );
  });

  it("recovers one independently reconciled payout leg without finalizing the deal", async () => {
    const h = applicationHarness(
      event(TonJettonChainEventKind.PAYOUT_LEG_RECONCILED, {
        settlementOutcome: "release",
        payoutLeg: "seller",
        amountAtomic: "4900000",
        destinationAddress: SELLER,
      }),
    );

    await h.service.applyNext();

    expect(h.circuitBreaker.assertEgressAllowed).toHaveBeenCalledTimes(1);
    expect(h.ledgerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        debitAccount: `escrow:ton:${DEAL_ID}`,
        creditAccount: "external_seller_usdt_ton",
        amount: "4.9",
      }),
    );
    expect(h.deal.status).toBe(DealStatus.PENDING_CONFIRMATION);
    expect(h.dealRepo.save).not.toHaveBeenCalled();
    expect(h.watch.status).toBe(TonJettonEscrowWatchStatus.SETTLEMENT_PENDING);
  });

  it("trips the TON circuit outside the rolled-back business transaction on source disagreement", async () => {
    const observed = event(TonJettonChainEventKind.FUNDING_CONFIRMED);
    (observed.evidence.application as Record<string, unknown>)[
      "independentSourceAgreementVerified"
    ] = false;
    observed.evidenceHash = tonJettonEvidenceHash(observed.evidence);
    const h = applicationHarness(observed);

    await expect(h.service.applyNext()).rejects.toThrow(
      "JETTON_APPLICATION_PROOF_BINDING_INVALID",
    );
    expect(h.circuitBreaker.tripChainIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "ton",
        reasonCode: "JETTON_PROOF_OR_SOURCE_DISAGREEMENT",
      }),
    );
    expect(h.ledgerRepo.save).not.toHaveBeenCalled();
    expect(h.dealRepo.save).not.toHaveBeenCalled();
    expect(h.watchRepo.save).not.toHaveBeenCalled();
  });
});
