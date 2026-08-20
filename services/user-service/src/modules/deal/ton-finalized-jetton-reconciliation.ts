import { createHash } from "crypto";
import { Address } from "@ton/core";
import type { TonProvenShardTransaction } from "../escrow/adapters/ton-proof/ton-transaction-inclusion-proof";
import type { TonProofBlockId } from "../escrow/adapters/ton-proof/ton-proof-envelope";
import type {
  TonJettonReconciliationExpectation,
  TonJettonReconciliationValidation,
} from "./ton-jetton-reconciliation-validator";

const HASH = /^[0-9a-f]{64}$/;

export interface TonJettonReconciliationFinalityProofs {
  ownerTransfer: TonProvenShardTransaction;
  senderWallet: TonProvenShardTransaction;
  recipientWallet: TonProvenShardTransaction;
}

export interface TonFinalizedJettonReconciliation {
  kind: "TON_FINALIZED_JETTON_RECONCILIATION";
  structuralChecksPassed: true;
  providerAgreementVerified: true;
  masterchainFinalityProven: true;
  allTransactionInclusionsVerified: true;
  transactionStateUpdatesBound: true;
  reconciliationFinalityProven: true;
  settlementAuthorized: false;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  remainingRequirement: "VERIFICATION_EVIDENCE_POLICY_REQUIRED";
  networkGlobalId: number;
  finalizedByMasterchainBlock: TonProofBlockId;
  settlementId: string;
  leg: "buyer" | "seller" | "treasury";
  attempt: number;
  ownerTransactionHash: string;
  senderTransactionHash: string;
  recipientTransactionHash: string;
  structuralAgreementFingerprint: string;
  finalityCompositionHash: string;
}

export class TonFinalizedJettonReconciliationError extends Error {
  readonly name = "TonFinalizedJettonReconciliationError";
}

function reject(message: string): never {
  throw new TonFinalizedJettonReconciliationError(message);
}

function requireHash(value: string, label: string): void {
  if (!HASH.test(value) || value === "0".repeat(64)) reject(`${label} is invalid`);
}

function canonicalAddress(value: string, label: string): string {
  if (!/^-?\d+:[0-9a-f]{64}$/.test(value)) {
    reject(`${label} must be canonical raw lowercase form`);
  }
  try {
    const address = Address.parseRaw(value);
    if (address.toRawString() !== value) reject(`${label} is not canonical`);
    return address.toRawString();
  } catch (error) {
    if (error instanceof TonFinalizedJettonReconciliationError) throw error;
    reject(`${label} is invalid`);
  }
}

function blockIdsEqual(left: TonProofBlockId, right: TonProofBlockId): boolean {
  return (
    left.workchain === right.workchain &&
    left.shard === right.shard &&
    left.seqno === right.seqno &&
    left.rootHash === right.rootHash &&
    left.fileHash === right.fileHash
  );
}

function shardHex(shard: string): string {
  try {
    return BigInt.asUintN(64, BigInt(shard)).toString(16).padStart(16, "0");
  } catch {
    reject("proven transaction shard is invalid");
  }
}

function validateProof(proof: TonProvenShardTransaction, label: string): void {
  if (
    proof.shardBlockFinalityProven !== true ||
    proof.accountBlockInclusionVerified !== true ||
    proof.transactionDictionaryInclusionVerified !== true ||
    proof.transactionCellVerified !== true ||
    proof.transactionInclusionVerified !== true ||
    proof.settlementAuthorized !== false ||
    proof.authorizationAllowed !== false ||
    proof.verificationEvidenceHash !== null
  ) {
    reject(`${label} proof provenance is invalid`);
  }
  requireHash(proof.transactionHash, `${label} transaction hash`);
  requireHash(proof.transactionBocHash, `${label} transaction BOC hash`);
  requireHash(proof.inclusionProofBocHash, `${label} inclusion proof BOC hash`);
  requireHash(proof.inclusionProofRootHash, `${label} inclusion proof root hash`);
  requireHash(proof.block.rootHash, `${label} block root hash`);
  requireHash(proof.block.fileHash, `${label} block file hash`);
  requireHash(
    proof.finalizedByMasterchainBlock.rootHash,
    `${label} finalized root hash`,
  );
  requireHash(
    proof.finalizedByMasterchainBlock.fileHash,
    `${label} finalized file hash`,
  );
  requireHash(proof.transactionOldStateHash, `${label} old state hash`);
  requireHash(proof.transactionNewStateHash, `${label} new state hash`);
  if (proof.transactionRoot.hash(0).toString("hex") !== proof.transactionHash) {
    reject(`${label} transaction cell no longer matches its proven hash`);
  }
}

interface StructuralBlockFingerprint {
  workchain: number;
  shard: string;
  seqno: number;
  rootHash: string;
  fileHash: string;
  masterchainSeqno: number;
}

function parseBlockFingerprint(
  value: string,
  label: string,
): StructuralBlockFingerprint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    reject(`${label} block fingerprint is not JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    reject(`${label} block fingerprint is invalid`);
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    "fileHash",
    "masterchainSeqno",
    "rootHash",
    "seqno",
    "shard",
    "workchain",
  ];
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
    reject(`${label} block fingerprint shape is invalid`);
  }
  if (
    !Number.isSafeInteger(record.workchain) ||
    typeof record.workchain !== "number" ||
    typeof record.shard !== "string" ||
    !/^[0-9a-f]{16}$/.test(record.shard) ||
    !Number.isSafeInteger(record.seqno) ||
    typeof record.seqno !== "number" ||
    record.seqno < 1 ||
    !Number.isSafeInteger(record.masterchainSeqno) ||
    typeof record.masterchainSeqno !== "number" ||
    record.masterchainSeqno < 1 ||
    typeof record.rootHash !== "string" ||
    typeof record.fileHash !== "string"
  ) {
    reject(`${label} block fingerprint fields are invalid`);
  }
  requireHash(record.rootHash, `${label} block root hash`);
  requireHash(record.fileHash, `${label} block file hash`);
  return record as unknown as StructuralBlockFingerprint;
}

function bindBlockFingerprint(
  value: string,
  proof: TonProvenShardTransaction,
  label: string,
): void {
  const block = parseBlockFingerprint(value, label);
  if (
    block.workchain !== proof.block.workchain ||
    block.shard !== shardHex(proof.block.shard) ||
    block.seqno !== proof.block.seqno ||
    block.rootHash !== proof.block.rootHash ||
    block.fileHash !== proof.block.fileHash ||
    block.masterchainSeqno !== proof.finalizedByMasterchainBlock.seqno
  ) {
    reject(`${label} structural block does not match its finalized proof`);
  }
}

function finalityHash(parts: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update("TON_FINALIZED_JETTON_RECONCILIATION_V1", "utf8");
  for (const part of parts) {
    const value = Buffer.from(part, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    hash.update(length);
    hash.update(value);
  }
  return hash.digest("hex");
}

export function composeTonFinalizedJettonReconciliation(
  structural: TonJettonReconciliationValidation,
  expectation: TonJettonReconciliationExpectation,
  proofs: TonJettonReconciliationFinalityProofs,
): TonFinalizedJettonReconciliation {
  const evidence = structural.evidence;
  if (
    structural.accepted !== false ||
    structural.reasonCode !== "MASTERCHAIN_PROOF_REQUIRED" ||
    evidence.structuralChecksPassed !== true ||
    evidence.finalityProven !== false ||
    evidence.settlementAuthorized !== false ||
    evidence.remainingRequirement !== "VERIFIED_MASTERCHAIN_SHARD_INCLUSION"
  ) {
    reject("structural reconciliation provenance is invalid");
  }
  requireHash(evidence.agreementFingerprint ?? "", "agreement fingerprint");
  if (
    evidence.settlementId !== expectation.settlementId ||
    evidence.leg !== expectation.leg ||
    evidence.attempt !== expectation.attempt ||
    evidence.senderWalletAddress !== expectation.senderWalletAddress ||
    evidence.recipientWalletAddress !== expectation.recipientWalletAddress ||
    evidence.amountAtomic !== expectation.amountAtomic ||
    evidence.queryId !== expectation.queryId
  ) {
    reject("structural reconciliation does not match the expectation");
  }
  const expectedAccounts = [
    canonicalAddress(expectation.ownerTransaction.accountAddress, "owner account"),
    canonicalAddress(expectation.senderWalletAddress, "sender wallet"),
    canonicalAddress(expectation.recipientWalletAddress, "recipient wallet"),
  ];
  const orderedProofs = [
    proofs.ownerTransfer,
    proofs.senderWallet,
    proofs.recipientWallet,
  ] as const;
  if (
    evidence.transactionHashes.length !== 3 ||
    evidence.transactionLts.length !== 3 ||
    evidence.blockFingerprints.length !== 3 ||
    evidence.stateHashes.length !== 4
  ) {
    reject("structural reconciliation evidence cardinality is invalid");
  }
  if (
    evidence.transactionHashes[0] !== expectation.ownerTransaction.hash ||
    evidence.transactionLts[0] !== expectation.ownerTransaction.lt
  ) {
    reject("structural owner transaction does not match the expectation");
  }
  orderedProofs.forEach((proof, index) => {
    const label = ["owner", "sender", "recipient"][index];
    validateProof(proof, label);
    if (
      proof.accountAddress !== expectedAccounts[index] ||
      proof.transactionHash !== evidence.transactionHashes[index] ||
      proof.transactionLt !== evidence.transactionLts[index]
    ) {
      reject(`${label} transaction proof does not match structural evidence`);
    }
    bindBlockFingerprint(evidence.blockFingerprints[index], proof, label);
  });
  const anchor = proofs.ownerTransfer.finalizedByMasterchainBlock;
  if (
    orderedProofs.some(
      (proof) =>
        proof.networkGlobalId !== proofs.ownerTransfer.networkGlobalId ||
        !blockIdsEqual(proof.finalizedByMasterchainBlock, anchor),
    )
  ) {
    reject("transaction proofs do not share one finalized masterchain anchor");
  }
  if (
    evidence.stateHashes[0] !== proofs.senderWallet.transactionOldStateHash ||
    evidence.stateHashes[1] !== proofs.senderWallet.transactionNewStateHash ||
    evidence.stateHashes[2] !== proofs.recipientWallet.transactionOldStateHash ||
    evidence.stateHashes[3] !== proofs.recipientWallet.transactionNewStateHash
  ) {
    reject("structural wallet states do not match proven transaction updates");
  }

  const composition = finalityHash([
    proofs.ownerTransfer.networkGlobalId.toString(),
    anchor.workchain.toString(),
    anchor.shard,
    anchor.seqno.toString(),
    anchor.rootHash,
    anchor.fileHash,
    expectation.settlementId,
    expectation.leg,
    expectation.attempt.toString(),
    expectation.amountAtomic,
    expectation.queryId,
    expectation.allowlistedMasterAddress,
    expectation.jettonWalletCodeHash,
    expectation.senderOwnerAddress,
    expectation.senderWalletAddress,
    expectation.recipientOwnerAddress,
    expectation.recipientWalletAddress,
    expectation.responseDestinationAddress,
    expectation.forwardTonAmountAtomic,
    expectation.forwardPayloadHash,
    evidence.agreementFingerprint!,
    ...orderedProofs.flatMap((proof) => [
      proof.block.workchain.toString(),
      proof.block.shard,
      proof.block.seqno.toString(),
      proof.block.rootHash,
      proof.block.fileHash,
      proof.transactionHash,
      proof.transactionBocHash,
      proof.inclusionProofBocHash,
      proof.transactionLt,
      proof.transactionOldStateHash,
      proof.transactionNewStateHash,
    ]),
  ]);
  return {
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
    networkGlobalId: proofs.ownerTransfer.networkGlobalId,
    finalizedByMasterchainBlock: { ...anchor },
    settlementId: expectation.settlementId,
    leg: expectation.leg,
    attempt: expectation.attempt,
    ownerTransactionHash: proofs.ownerTransfer.transactionHash,
    senderTransactionHash: proofs.senderWallet.transactionHash,
    recipientTransactionHash: proofs.recipientWallet.transactionHash,
    structuralAgreementFingerprint: evidence.agreementFingerprint!,
    finalityCompositionHash: composition,
  };
}
