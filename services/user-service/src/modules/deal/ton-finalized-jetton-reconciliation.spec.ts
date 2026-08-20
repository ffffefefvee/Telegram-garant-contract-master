import { Address, beginCell, Cell } from "@ton/core";
import type { TonProvenShardTransaction } from "../escrow/adapters/ton-proof/ton-transaction-inclusion-proof";
import {
  composeTonFinalizedJettonReconciliation,
  TonFinalizedJettonReconciliationError,
} from "./ton-finalized-jetton-reconciliation";
import { createTonSettlementVerificationEvidence } from "./ton-settlement-verification-evidence";
import type { TonVerificationEvidencePolicy } from "../escrow/adapters/ton-proof/ton-verification-evidence";
import type {
  TonJettonReconciliationExpectation,
  TonJettonReconciliationValidation,
} from "./ton-jetton-reconciliation-validator";

const FULL_SHARD = "-9223372036854775808";
const owner = Address.parseRaw(`0:${"11".repeat(32)}`).toRawString();
const senderWallet = Address.parseRaw(`0:${"22".repeat(32)}`).toRawString();
const recipientOwner = Address.parseRaw(`0:${"33".repeat(32)}`).toRawString();
const recipientWallet = Address.parseRaw(`0:${"44".repeat(32)}`).toRawString();
const master = Address.parseRaw(`0:${"55".repeat(32)}`).toRawString();
const response = Address.parseRaw(`0:${"66".repeat(32)}`).toRawString();
const payloadHash = "77".repeat(32);
const walletCodeHash = "88".repeat(32);
const senderOld = "a1".repeat(32);
const senderNew = "a2".repeat(32);
const recipientOld = "b1".repeat(32);
const recipientNew = "b2".repeat(32);

function anchor() {
  return {
    workchain: -1,
    shard: FULL_SHARD,
    seqno: 120,
    rootHash: "99".repeat(32),
    fileHash: "aa".repeat(32),
  };
}

function transactionRoot(index: number): Cell {
  return beginCell().storeUint(0x7000 + index, 16).endCell();
}

function proof(
  accountAddress: string,
  lt: string,
  index: number,
  oldStateHash: string,
  newStateHash: string,
): TonProvenShardTransaction {
  const root = transactionRoot(index);
  return {
    kind: "TON_PROVEN_SHARD_TRANSACTION",
    shardBlockFinalityProven: true,
    accountBlockInclusionVerified: true,
    transactionDictionaryInclusionVerified: true,
    transactionCellVerified: true,
    transactionInclusionVerified: true,
    settlementAuthorized: false,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: -3,
    finalizedByMasterchainBlock: anchor(),
    block: {
      workchain: 0,
      shard: FULL_SHARD,
      seqno: 70 + index,
      rootHash: `${index + 1}`.repeat(64),
      fileHash: `${index + 4}`.repeat(64),
    },
    accountAddress,
    transactionLt: lt,
    transactionHash: root.hash(0).toString("hex"),
    transactionBocHash: `${index + 7}`.repeat(64),
    inclusionProofBocHash: `${index + 3}`.repeat(64),
    inclusionProofRootHash: `${index + 4}`.repeat(64),
    previousTransactionHash: `${index + 5}`.repeat(64),
    previousTransactionLt: (BigInt(lt) - 1n).toString(),
    transactionUnixTime: 1_800_000_000 + index,
    transactionOldStateHash: oldStateHash,
    transactionNewStateHash: newStateHash,
    accountBlockOldStateHash: oldStateHash,
    accountBlockNewStateHash: newStateHash,
    transactionRoot: root,
  };
}

function proofs() {
  return {
    ownerTransfer: proof(owner, "700", 0, "c1".repeat(32), "c2".repeat(32)),
    senderWallet: proof(senderWallet, "701", 1, senderOld, senderNew),
    recipientWallet: proof(
      recipientWallet,
      "702",
      2,
      recipientOld,
      recipientNew,
    ),
  };
}

function expectation(): TonJettonReconciliationExpectation {
  const ownerProof = proofs().ownerTransfer;
  return {
    settlementId: "settlement-1",
    leg: "seller",
    attempt: 1,
    allowlistedMasterAddress: master,
    jettonWalletCodeHash: walletCodeHash,
    senderOwnerAddress: owner,
    senderWalletAddress: senderWallet,
    recipientOwnerAddress: recipientOwner,
    recipientWalletAddress: recipientWallet,
    amountAtomic: "5000000",
    queryId: "42",
    responseDestinationAddress: response,
    forwardTonAmountAtomic: "1",
    forwardPayloadHash: payloadHash,
    ownerTransaction: {
      accountAddress: owner,
      lt: "700",
      hash: ownerProof.transactionHash,
    },
    ownerOutbox: [
      {
        leg: "seller",
        attempt: 1,
        queryId: "42",
        amountAtomic: "5000000",
        destinationOwnerAddress: recipientOwner,
        recipientWalletAddress: recipientWallet,
        responseDestinationAddress: response,
        forwardTonAmountAtomic: "1",
        forwardPayloadHash: payloadHash,
      },
    ],
    collectors: [
      { sourceId: "source-a", operatorId: "operator-a" },
      { sourceId: "source-b", operatorId: "operator-b" },
    ],
  };
}

function blockFingerprint(value: TonProvenShardTransaction): string {
  return JSON.stringify({
    workchain: value.block.workchain,
    shard: "8000000000000000",
    seqno: value.block.seqno,
    rootHash: value.block.rootHash,
    fileHash: value.block.fileHash,
    masterchainSeqno: value.finalizedByMasterchainBlock.seqno,
  });
}

function structural(input = proofs()): TonJettonReconciliationValidation {
  return {
    accepted: false,
    reasonCode: "MASTERCHAIN_PROOF_REQUIRED",
    evidence: {
      sourceIds: ["source-a", "source-b"],
      operatorIds: ["operator-a", "operator-b"],
      settlementId: "settlement-1",
      leg: "seller",
      attempt: 1,
      transactionHashes: [
        input.ownerTransfer.transactionHash,
        input.senderWallet.transactionHash,
        input.recipientWallet.transactionHash,
      ],
      transactionLts: ["700", "701", "702"],
      messageHashes: ["dd".repeat(32)],
      stateHashes: [senderOld, senderNew, recipientOld, recipientNew],
      blockFingerprints: [
        blockFingerprint(input.ownerTransfer),
        blockFingerprint(input.senderWallet),
        blockFingerprint(input.recipientWallet),
      ],
      senderWalletAddress: senderWallet,
      recipientWalletAddress: recipientWallet,
      senderBalanceBefore: "10000000",
      senderBalanceAfter: "5000000",
      recipientBalanceBefore: "1000000",
      recipientBalanceAfter: "6000000",
      amountAtomic: "5000000",
      queryId: "42",
      agreementFingerprint: "ee".repeat(32),
      structuralChecksPassed: true,
      finalityProven: false,
      settlementAuthorized: false,
      remainingRequirement: "VERIFIED_MASTERCHAIN_SHARD_INCLUSION",
    },
  };
}

function evidencePolicy(): TonVerificationEvidencePolicy {
  return {
    schemaVersion: 1,
    policyId: "ton-testnet-settlement-evidence-v1",
    verifierVersion: "ton-proof-kernel-v1",
    networkGlobalId: -3,
    minimumMasterchainSeqno: 100,
    trustedNetworkConfigHash: "d1".repeat(32),
    proofFixtureManifestHash: "d2".repeat(32),
    independentReviewHash: "d3".repeat(32),
  };
}

describe("TON finalized Jetton reconciliation composition", () => {
  it("binds all structural transactions and states to one finalized anchor", () => {
    const input = proofs();
    const result = composeTonFinalizedJettonReconciliation(
      structural(input),
      expectation(),
      input,
    );
    expect(result).toMatchObject({
      kind: "TON_FINALIZED_JETTON_RECONCILIATION",
      structuralChecksPassed: true,
      providerAgreementVerified: true,
      masterchainFinalityProven: true,
      allTransactionInclusionsVerified: true,
      transactionStateUpdatesBound: true,
      reconciliationFinalityProven: true,
      settlementAuthorized: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      remainingRequirement: "VERIFICATION_EVIDENCE_POLICY_REQUIRED",
      networkGlobalId: -3,
      settlementId: "settlement-1",
      leg: "seller",
      attempt: 1,
      structuralAgreementFingerprint: "ee".repeat(32),
    });
    expect(result.finalityCompositionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces deterministic finality composition evidence", () => {
    const input = proofs();
    const first = composeTonFinalizedJettonReconciliation(structural(input), expectation(), input);
    const second = composeTonFinalizedJettonReconciliation(structural(input), expectation(), input);
    expect(second.finalityCompositionHash).toBe(first.finalityCompositionHash);
  });

  it("rejects a structural result that did not reach the finality boundary", () => {
    const input = proofs();
    const value = structural(input);
    value.reasonCode = "SOURCE_DISAGREEMENT";
    expect(() =>
      composeTonFinalizedJettonReconciliation(value, expectation(), input),
    ).toThrow("structural reconciliation provenance");
  });

  it("rejects expectation drift", () => {
    const input = proofs();
    expect(() =>
      composeTonFinalizedJettonReconciliation(structural(input), {
        ...expectation(),
        settlementId: "settlement-2",
      }, input),
    ).toThrow("does not match the expectation");
  });

  it("rejects malformed structural evidence cardinality", () => {
    const input = proofs();
    const value = structural(input);
    value.evidence.transactionHashes.pop();
    expect(() =>
      composeTonFinalizedJettonReconciliation(value, expectation(), input),
    ).toThrow("cardinality");
  });

  it("rejects a forged transaction-proof provenance flag", () => {
    const input = proofs();
    input.senderWallet.settlementAuthorized = true as false;
    expect(() =>
      composeTonFinalizedJettonReconciliation(structural(input), expectation(), input),
    ).toThrow("sender proof provenance");
  });

  it.each([
    ["account", "accountAddress", recipientWallet],
    ["logical time", "transactionLt", "999"],
  ] as const)("rejects sender transaction %s drift", (_label, field, value) => {
    const input = proofs();
    input.senderWallet[field] = value;
    expect(() =>
      composeTonFinalizedJettonReconciliation(structural(), expectation(), input),
    ).toThrow("sender transaction proof");
  });

  it("rejects a structural transaction hash substituted after validation", () => {
    const input = proofs();
    const structuralInput = structural(input);
    structuralInput.evidence.transactionHashes[1] = "ff".repeat(32);
    expect(() =>
      composeTonFinalizedJettonReconciliation(structuralInput, expectation(), input),
    ).toThrow("sender transaction proof");
  });

  it("rejects a transaction cell that no longer matches its proof hash", () => {
    const input = proofs();
    input.senderWallet.transactionRoot = beginCell().storeUint(1, 1).endCell();
    expect(() =>
      composeTonFinalizedJettonReconciliation(structural(input), expectation(), input),
    ).toThrow("transaction cell");
  });

  it.each([
    ["root", "rootHash", "ff".repeat(32)],
    ["file", "fileHash", "fe".repeat(32)],
    ["sequence", "seqno", 999],
  ] as const)("rejects structural block %s drift", (_label, field, value) => {
    const input = proofs();
    const structuralInput = structural(input);
    const block = JSON.parse(structuralInput.evidence.blockFingerprints[1]);
    block[field] = value;
    structuralInput.evidence.blockFingerprints[1] = JSON.stringify(block);
    expect(() =>
      composeTonFinalizedJettonReconciliation(structuralInput, expectation(), input),
    ).toThrow("structural block");
  });

  it("rejects a malformed block fingerprint shape", () => {
    const input = proofs();
    const value = structural(input);
    value.evidence.blockFingerprints[0] = "{}";
    expect(() =>
      composeTonFinalizedJettonReconciliation(value, expectation(), input),
    ).toThrow("fingerprint shape");
  });

  it("rejects transaction proofs from different finalized anchors", () => {
    const input = proofs();
    input.recipientWallet.finalizedByMasterchainBlock = {
      ...input.recipientWallet.finalizedByMasterchainBlock,
      rootHash: "ff".repeat(32),
    };
    const value = structural(input);
    const block = JSON.parse(value.evidence.blockFingerprints[2]);
    block.masterchainSeqno = 120;
    value.evidence.blockFingerprints[2] = JSON.stringify(block);
    expect(() =>
      composeTonFinalizedJettonReconciliation(value, expectation(), input),
    ).toThrow("one finalized masterchain anchor");
  });

  it("rejects transaction proofs from another network", () => {
    const input = proofs();
    input.recipientWallet.networkGlobalId = -239;
    expect(() =>
      composeTonFinalizedJettonReconciliation(structural(input), expectation(), input),
    ).toThrow("one finalized masterchain anchor");
  });

  it.each([
    ["sender old", 0, "ff".repeat(32)],
    ["sender new", 1, "fe".repeat(32)],
    ["recipient old", 2, "fd".repeat(32)],
    ["recipient new", 3, "fc".repeat(32)],
  ] as const)("rejects %s state substitution", (_label, index, value) => {
    const input = proofs();
    const structuralInput = structural(input);
    structuralInput.evidence.stateHashes[index] = value;
    expect(() =>
      composeTonFinalizedJettonReconciliation(structuralInput, expectation(), input),
    ).toThrow("wallet states");
  });

  it("uses a dedicated error for an invalid agreement fingerprint", () => {
    const input = proofs();
    const value = structural(input);
    value.evidence.agreementFingerprint = null;
    expect(() =>
      composeTonFinalizedJettonReconciliation(value, expectation(), input),
    ).toThrow(TonFinalizedJettonReconciliationError);
  });

  it("re-runs final reconciliation before emitting verification evidence", () => {
    const input = proofs();
    const result = createTonSettlementVerificationEvidence(
      structural(input),
      expectation(),
      input,
      evidencePolicy(),
    );
    expect(result).toMatchObject({
      scope: "settlement_reconciliation",
      subjectId: "settlement-1:seller:1",
      proofVerificationSucceeded: true,
      settlementAuthorized: false,
      authorizationAllowed: false,
      remainingRequirement: "THRESHOLD_APPROVAL_REQUIRED",
    });
  });

  it("does not emit settlement evidence from a forged transaction proof", () => {
    const input = proofs();
    input.senderWallet.authorizationAllowed = true as false;
    expect(() =>
      createTonSettlementVerificationEvidence(
        structural(input),
        expectation(),
        input,
        evidencePolicy(),
      ),
    ).toThrow("sender proof provenance");
  });
});
