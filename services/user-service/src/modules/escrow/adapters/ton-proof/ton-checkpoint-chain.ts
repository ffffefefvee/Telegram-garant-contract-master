import { createHash } from "crypto";
import type {
  TonLiteProofLimits,
  TonLitePartialBlockProof,
} from "./ton-lite-signature-proof";
import { decodeTonLitePartialBlockProof } from "./ton-lite-signature-proof";
import type {
  TonProofBlockId,
  TonProofResourceLimits,
} from "./ton-proof-envelope";
import type { TonVerifiedForwardKeyBlockLink } from "./ton-forward-link-proof";
import { verifyTonForwardKeyBlockLink } from "./ton-forward-link-proof";

const MAX_LITESERVER_LINKS = 16;

export interface TonCheckpointChainExpectation {
  policyVersion: string;
  globalId: number;
  trustedKeyBlock: TonProofBlockId;
  targetBlock: TonProofBlockId;
  observedAtUnix: number;
  nowUnix: number;
  maxProofAgeSeconds: number;
  maxFutureSkewSeconds: number;
  liteLimits: TonLiteProofLimits;
  bocLimits: TonProofResourceLimits;
}

export interface TonProvenMasterchainCheckpointChain {
  kind: "TON_PROVEN_MASTERCHAIN_CHECKPOINT_CHAIN";
  proofDecoded: true;
  endpointsVerified: true;
  completenessVerified: true;
  allLinksVerified: true;
  supportedConsensusVerified: true;
  ordinaryConsensusVerified: boolean;
  simplexConsensusVerified: boolean;
  masterchainFinalityProven: true;
  finalityProven: true;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  networkGlobalId: number;
  policyVersion: string;
  trustedKeyBlock: TonProofBlockId;
  targetBlock: TonProofBlockId;
  targetGeneratedAtUnix: number;
  observedAtUnix: number;
  linkCount: number;
  latestKeyBlock: TonProofBlockId | null;
  rawProofHash: string;
  checkpointEvidenceHash: string;
  links: readonly TonVerifiedForwardKeyBlockLink[];
}

export class TonCheckpointChainError extends Error {
  readonly name = "TonCheckpointChainError";
}

function reject(message: string): never {
  throw new TonCheckpointChainError(message);
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

function requirePolicyInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(`${label} is out of range`);
  }
}

function validateExpectation(expectation: TonCheckpointChainExpectation): void {
  if (
    typeof expectation.policyVersion !== "string" ||
    expectation.policyVersion.length === 0 ||
    expectation.policyVersion.length > 128
  ) {
    reject("policyVersion is invalid");
  }
  requirePolicyInteger(
    expectation.globalId,
    -0x80000000,
    0x7fffffff,
    "globalId",
  );
  requirePolicyInteger(
    expectation.observedAtUnix,
    0,
    Number.MAX_SAFE_INTEGER,
    "observedAtUnix",
  );
  requirePolicyInteger(
    expectation.nowUnix,
    0,
    Number.MAX_SAFE_INTEGER,
    "nowUnix",
  );
  requirePolicyInteger(
    expectation.maxProofAgeSeconds,
    1,
    30 * 24 * 60 * 60,
    "maxProofAgeSeconds",
  );
  requirePolicyInteger(
    expectation.maxFutureSkewSeconds,
    0,
    24 * 60 * 60,
    "maxFutureSkewSeconds",
  );
  if (expectation.targetBlock.seqno <= expectation.trustedKeyBlock.seqno) {
    reject("target block does not advance the trusted key block");
  }
  if (
    expectation.observedAtUnix >
    expectation.nowUnix + expectation.maxFutureSkewSeconds
  ) {
    reject("proof observation time is from the future");
  }
  if (
    expectation.nowUnix - expectation.observedAtUnix >
    expectation.maxProofAgeSeconds
  ) {
    reject("proof observation is stale");
  }
}

function verifyDecodedChain(
  proof: TonLitePartialBlockProof,
  expectation: TonCheckpointChainExpectation,
): TonProvenMasterchainCheckpointChain {
  if (!proof.complete) reject("partialBlockProof is incomplete");
  if (!blockIdsEqual(proof.from, expectation.trustedKeyBlock)) {
    reject("partialBlockProof origin is not the trusted key block");
  }
  if (!blockIdsEqual(proof.to, expectation.targetBlock)) {
    reject("partialBlockProof destination is not the expected target");
  }
  if (proof.steps.length === 0) reject("checkpoint chain has no links");
  if (proof.steps.length > MAX_LITESERVER_LINKS) {
    reject("checkpoint chain exceeds the LiteServer link cap");
  }

  const links: TonVerifiedForwardKeyBlockLink[] = [];
  let trustedSource = { ...expectation.trustedKeyBlock };
  let latestKeyBlock: TonProofBlockId | null = { ...trustedSource };
  for (let index = 0; index < proof.steps.length; index += 1) {
    const step = proof.steps[index];
    if (step.kind !== "forward") {
      reject(`checkpoint chain link ${index} is not a forward link`);
    }
    const verified = verifyTonForwardKeyBlockLink(step, {
      globalId: expectation.globalId,
      trustedSourceKeyBlock: trustedSource,
      limits: expectation.bocLimits,
    });
    const isLast = index === proof.steps.length - 1;
    if (!isLast && !verified.destinationIsKeyBlock) {
      reject(`checkpoint chain link ${index} does not end at a key block`);
    }
    if (verified.destinationIsKeyBlock) {
      latestKeyBlock = { ...verified.destinationBlock };
    }
    trustedSource = { ...verified.destinationBlock };
    links.push(verified);
  }

  const targetGeneratedAtUnix =
    links[links.length - 1].destinationGeneratedAtUnix;
  if (
    targetGeneratedAtUnix >
    expectation.observedAtUnix + expectation.maxFutureSkewSeconds
  ) {
    reject("target block generation time is after the proof observation");
  }
  if (
    targetGeneratedAtUnix >
    expectation.nowUnix + expectation.maxFutureSkewSeconds
  ) {
    reject("target block generation time is from the future");
  }
  if (
    expectation.nowUnix - targetGeneratedAtUnix >
    expectation.maxProofAgeSeconds
  ) {
    reject("target block is stale");
  }

  const evidence = {
    domain: "telegram-garant/ton-masterchain-checkpoint-chain/v1",
    policyVersion: expectation.policyVersion,
    globalId: expectation.globalId,
    trustedKeyBlock: expectation.trustedKeyBlock,
    targetBlock: expectation.targetBlock,
    observedAtUnix: expectation.observedAtUnix,
    rawProofHash: proof.rawHash,
    links: links.map((link) => ({
      sourceBlock: link.sourceBlock,
      destinationBlock: link.destinationBlock,
      destinationIsKeyBlock: link.destinationIsKeyBlock,
      configProofRootHash: link.configProofRootHash,
      destinationProofRootHash: link.destinationProofRootHash,
      configRootHash: link.configRootHash,
      validatorParameter: link.validatorParameter,
      catchainParameter: link.catchainParameter,
      catchainSeqno: link.catchainSeqno,
      validatorSetHash: link.validatorSetHash,
      consensus: link.consensus,
      signedDataHash: link.signedDataHash,
      signedWeight: link.signedWeight,
      totalWeight: link.totalWeight,
      signerCount: link.signerCount,
    })),
  };

  return {
    kind: "TON_PROVEN_MASTERCHAIN_CHECKPOINT_CHAIN",
    proofDecoded: true,
    endpointsVerified: true,
    completenessVerified: true,
    allLinksVerified: true,
    supportedConsensusVerified: true,
    ordinaryConsensusVerified: links.every(
      (link) => link.consensus === "ordinary",
    ),
    simplexConsensusVerified: links.some(
      (link) => link.consensus === "simplex",
    ),
    masterchainFinalityProven: true,
    finalityProven: true,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: expectation.globalId,
    policyVersion: expectation.policyVersion,
    trustedKeyBlock: { ...expectation.trustedKeyBlock },
    targetBlock: { ...expectation.targetBlock },
    targetGeneratedAtUnix,
    observedAtUnix: expectation.observedAtUnix,
    linkCount: links.length,
    latestKeyBlock,
    rawProofHash: proof.rawHash,
    checkpointEvidenceHash: createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex"),
    links,
  };
}

export function verifyTonMasterchainCheckpointChain(
  rawPartialBlockProofBase64: unknown,
  expectation: TonCheckpointChainExpectation,
): TonProvenMasterchainCheckpointChain {
  validateExpectation(expectation);
  const proof = decodeTonLitePartialBlockProof(
    rawPartialBlockProofBase64,
    expectation.liteLimits,
  );
  return verifyDecodedChain(proof, expectation);
}
