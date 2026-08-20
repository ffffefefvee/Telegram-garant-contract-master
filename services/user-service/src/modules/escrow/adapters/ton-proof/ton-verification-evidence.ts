import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "crypto";

const HASH = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{3,128}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type TonVerificationEvidenceScope =
  | "wallet_seal"
  | "settlement_reconciliation";

export interface TonVerificationEvidencePolicy {
  schemaVersion: 1;
  policyId: string;
  verifierVersion: string;
  networkGlobalId: number;
  minimumMasterchainSeqno: number;
  trustedNetworkConfigHash: string;
  proofFixtureManifestHash: string;
  independentReviewHash: string;
}

export interface TonVerificationEvidenceSubject {
  scope: TonVerificationEvidenceScope;
  networkGlobalId: number;
  masterchainSeqno: number;
  masterchainRootHash: string;
  masterchainFileHash: string;
  subjectId: string;
  proofCompositionHash: string;
}

export interface TonVerificationEvidence {
  kind: "TON_VERIFICATION_EVIDENCE";
  schemaVersion: 1;
  proofVerificationSucceeded: true;
  evidencePolicyVerified: true;
  thresholdApprovalVerified: false;
  sealingAuthorized: false;
  settlementAuthorized: false;
  authorizationAllowed: false;
  scope: TonVerificationEvidenceScope;
  networkGlobalId: number;
  masterchainSeqno: number;
  masterchainRootHash: string;
  masterchainFileHash: string;
  subjectId: string;
  proofCompositionHash: string;
  evidencePolicyId: string;
  evidencePolicyHash: string;
  verificationEvidenceHash: string;
  remainingRequirement: "THRESHOLD_APPROVAL_REQUIRED";
}

export interface TonApprovalSigner {
  signerId: string;
  enabled: boolean;
  publicKeySpkiDerBase64: string;
}

export interface TonThresholdApprovalPolicy {
  schemaVersion: 1;
  policyId: string;
  scope: TonVerificationEvidenceScope;
  networkGlobalId: number;
  evidencePolicyHash: string;
  threshold: number;
  signers: readonly TonApprovalSigner[];
}

export interface TonEvidenceSignature {
  signerId: string;
  algorithm: "ed25519";
  signatureBase64: string;
}

export interface TonApprovedVerificationEvidence
  extends Omit<
    TonVerificationEvidence,
    | "kind"
    | "thresholdApprovalVerified"
    | "sealingAuthorized"
    | "settlementAuthorized"
    | "authorizationAllowed"
    | "remainingRequirement"
  > {
  kind: "TON_APPROVED_VERIFICATION_EVIDENCE";
  thresholdApprovalVerified: true;
  sealingAuthorized: boolean;
  settlementAuthorized: boolean;
  authorizationAllowed: true;
  approvalPolicyId: string;
  approvalPolicyHash: string;
  approvalThreshold: number;
  verifiedSigners: string[];
  approvalArtifactHash: string;
}

export class TonVerificationEvidenceError extends Error {
  readonly name = "TonVerificationEvidenceError";
}

function reject(message: string): never {
  throw new TonVerificationEvidenceError(message);
}

function requireExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (
    actual.length !== canonical.length ||
    actual.some((key, index) => key !== canonical[index])
  ) {
    reject(`${label} shape is invalid`);
  }
}

function requireIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) reject(`${label} is invalid`);
}

function requireHash(value: string, label: string): void {
  if (!HASH.test(value) || value === "0".repeat(64)) {
    reject(`${label} is invalid`);
  }
}

function requireNetworkGlobalId(value: number): void {
  if (value !== -3 && value !== -239) {
    reject("networkGlobalId must identify TON testnet or mainnet");
  }
}

function requireScope(value: TonVerificationEvidenceScope): void {
  if (value !== "wallet_seal" && value !== "settlement_reconciliation") {
    reject("verification evidence scope is invalid");
  }
}

function requireSeqno(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) reject(`${label} is invalid`);
}

function hashParts(domain: string, parts: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  for (const part of parts) {
    const encoded = Buffer.from(part, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(encoded.length);
    hash.update(length);
    hash.update(encoded);
  }
  return hash.digest("hex");
}

function evidencePolicyHash(policy: TonVerificationEvidencePolicy): string {
  return hashParts("TON_VERIFICATION_EVIDENCE_POLICY_V1", [
    policy.policyId,
    policy.verifierVersion,
    policy.networkGlobalId.toString(),
    policy.minimumMasterchainSeqno.toString(),
    policy.trustedNetworkConfigHash,
    policy.proofFixtureManifestHash,
    policy.independentReviewHash,
  ]);
}

function validateEvidencePolicy(policy: TonVerificationEvidencePolicy): string {
  requireExactKeys(
    policy,
    [
      "schemaVersion",
      "policyId",
      "verifierVersion",
      "networkGlobalId",
      "minimumMasterchainSeqno",
      "trustedNetworkConfigHash",
      "proofFixtureManifestHash",
      "independentReviewHash",
    ],
    "evidence policy",
  );
  if (policy.schemaVersion !== 1) reject("evidence policy schema is invalid");
  requireIdentifier(policy.policyId, "evidence policy ID");
  requireIdentifier(policy.verifierVersion, "verifier version");
  requireNetworkGlobalId(policy.networkGlobalId);
  requireSeqno(policy.minimumMasterchainSeqno, "minimum masterchain seqno");
  requireHash(policy.trustedNetworkConfigHash, "trusted network config hash");
  requireHash(policy.proofFixtureManifestHash, "proof fixture manifest hash");
  requireHash(policy.independentReviewHash, "independent review hash");
  return evidencePolicyHash(policy);
}

/**
 * Low-level commitment primitive. Callers must first re-run the complete proof
 * composition and pass only its canonical identifiers as `subject`.
 */
export function commitTonVerificationEvidence(
  subject: TonVerificationEvidenceSubject,
  policy: TonVerificationEvidencePolicy,
): TonVerificationEvidence {
  const policyHash = validateEvidencePolicy(policy);
  requireExactKeys(
    subject,
    [
      "scope",
      "networkGlobalId",
      "masterchainSeqno",
      "masterchainRootHash",
      "masterchainFileHash",
      "subjectId",
      "proofCompositionHash",
    ],
    "verification evidence subject",
  );
  requireScope(subject.scope);
  requireNetworkGlobalId(subject.networkGlobalId);
  requireSeqno(subject.masterchainSeqno, "masterchain seqno");
  requireIdentifier(subject.subjectId, "evidence subject ID");
  requireHash(subject.masterchainRootHash, "masterchain root hash");
  requireHash(subject.masterchainFileHash, "masterchain file hash");
  requireHash(subject.proofCompositionHash, "proof composition hash");
  if (subject.networkGlobalId !== policy.networkGlobalId) {
    reject("evidence policy is bound to another network");
  }
  if (subject.masterchainSeqno < policy.minimumMasterchainSeqno) {
    reject("masterchain anchor predates the evidence policy floor");
  }
  const verificationEvidenceHash = hashParts("TON_VERIFICATION_EVIDENCE_V1", [
    subject.scope,
    subject.networkGlobalId.toString(),
    subject.masterchainSeqno.toString(),
    subject.masterchainRootHash,
    subject.masterchainFileHash,
    subject.subjectId,
    subject.proofCompositionHash,
    policy.policyId,
    policyHash,
  ]);
  return {
    kind: "TON_VERIFICATION_EVIDENCE",
    schemaVersion: 1,
    proofVerificationSucceeded: true,
    evidencePolicyVerified: true,
    thresholdApprovalVerified: false,
    sealingAuthorized: false,
    settlementAuthorized: false,
    authorizationAllowed: false,
    scope: subject.scope,
    networkGlobalId: subject.networkGlobalId,
    masterchainSeqno: subject.masterchainSeqno,
    masterchainRootHash: subject.masterchainRootHash,
    masterchainFileHash: subject.masterchainFileHash,
    subjectId: subject.subjectId,
    proofCompositionHash: subject.proofCompositionHash,
    evidencePolicyId: policy.policyId,
    evidencePolicyHash: policyHash,
    verificationEvidenceHash,
    remainingRequirement: "THRESHOLD_APPROVAL_REQUIRED",
  };
}

function approvalPolicyHash(policy: TonThresholdApprovalPolicy): string {
  return hashParts("TON_THRESHOLD_APPROVAL_POLICY_V1", [
    policy.policyId,
    policy.scope,
    policy.networkGlobalId.toString(),
    policy.evidencePolicyHash,
    policy.threshold.toString(),
    ...policy.signers.flatMap((signer) => [
      signer.signerId,
      signer.enabled ? "1" : "0",
      signer.publicKeySpkiDerBase64,
    ]),
  ]);
}

function validateApprovalPolicy(policy: TonThresholdApprovalPolicy): string {
  requireExactKeys(
    policy,
    [
      "schemaVersion",
      "policyId",
      "scope",
      "networkGlobalId",
      "evidencePolicyHash",
      "threshold",
      "signers",
    ],
    "approval policy",
  );
  if (policy.schemaVersion !== 1) reject("approval policy schema is invalid");
  requireIdentifier(policy.policyId, "approval policy ID");
  requireScope(policy.scope);
  requireNetworkGlobalId(policy.networkGlobalId);
  requireHash(policy.evidencePolicyHash, "approval evidence policy hash");
  if (
    !Number.isSafeInteger(policy.threshold) ||
    policy.threshold < 2 ||
    policy.threshold > policy.signers.length
  ) {
    reject("approval threshold is invalid");
  }
  if (policy.signers.length > 64) reject("approval signer set is too large");
  let previous = "";
  for (const signer of policy.signers) {
    requireExactKeys(
      signer,
      ["signerId", "enabled", "publicKeySpkiDerBase64"],
      "approval signer",
    );
    requireIdentifier(signer.signerId, "approval signer ID");
    if (signer.signerId <= previous) {
      reject("approval signers must be distinct and sorted");
    }
    previous = signer.signerId;
    const encoded = Buffer.from(signer.publicKeySpkiDerBase64, "base64");
    if (
      !BASE64.test(signer.publicKeySpkiDerBase64) ||
      encoded.toString("base64") !== signer.publicKeySpkiDerBase64
    ) {
      reject(`approval public key for ${signer.signerId} is invalid`);
    }
    try {
      const key = createPublicKey({ key: encoded, format: "der", type: "spki" });
      if (key.asymmetricKeyType !== "ed25519") {
        reject(`approval public key for ${signer.signerId} is not Ed25519`);
      }
    } catch (error) {
      if (error instanceof TonVerificationEvidenceError) throw error;
      reject(`approval public key for ${signer.signerId} is invalid`);
    }
  }
  const enabled = policy.signers.filter((signer) => signer.enabled).length;
  if (enabled < policy.threshold) {
    reject("approval policy has fewer enabled signers than its threshold");
  }
  return approvalPolicyHash(policy);
}

export function tonEvidenceApprovalSigningPayload(
  evidence: TonVerificationEvidence,
  evidencePolicy: TonVerificationEvidencePolicy,
  policy: TonThresholdApprovalPolicy,
): Buffer {
  const policyHash = validateApprovalPolicy(policy);
  validateUnapprovedEvidence(evidence, evidencePolicy);
  if (
    policy.scope !== evidence.scope ||
    policy.networkGlobalId !== evidence.networkGlobalId ||
    policy.evidencePolicyHash !== evidence.evidencePolicyHash
  ) {
    reject("approval policy does not match verification evidence");
  }
  return Buffer.from(
    hashParts("TON_VERIFICATION_EVIDENCE_APPROVAL_PAYLOAD_V1", [
      evidence.scope,
      evidence.networkGlobalId.toString(),
      evidence.subjectId,
      evidence.verificationEvidenceHash,
      policy.policyId,
      policyHash,
    ]),
    "hex",
  );
}

function validateUnapprovedEvidence(
  evidence: TonVerificationEvidence,
  policy: TonVerificationEvidencePolicy,
): void {
  requireExactKeys(
    evidence,
    [
      "kind",
      "schemaVersion",
      "proofVerificationSucceeded",
      "evidencePolicyVerified",
      "thresholdApprovalVerified",
      "sealingAuthorized",
      "settlementAuthorized",
      "authorizationAllowed",
      "scope",
      "networkGlobalId",
      "masterchainSeqno",
      "masterchainRootHash",
      "masterchainFileHash",
      "subjectId",
      "proofCompositionHash",
      "evidencePolicyId",
      "evidencePolicyHash",
      "verificationEvidenceHash",
      "remainingRequirement",
    ],
    "verification evidence",
  );
  if (
    evidence.kind !== "TON_VERIFICATION_EVIDENCE" ||
    evidence.schemaVersion !== 1 ||
    evidence.proofVerificationSucceeded !== true ||
    evidence.evidencePolicyVerified !== true ||
    evidence.thresholdApprovalVerified !== false ||
    evidence.sealingAuthorized !== false ||
    evidence.settlementAuthorized !== false ||
    evidence.authorizationAllowed !== false ||
    evidence.remainingRequirement !== "THRESHOLD_APPROVAL_REQUIRED"
  ) {
    reject("verification evidence provenance is invalid");
  }
  requireHash(evidence.verificationEvidenceHash, "verification evidence hash");
  requireHash(evidence.evidencePolicyHash, "evidence policy hash");
  requireHash(evidence.proofCompositionHash, "proof composition hash");
  const recomputed = commitTonVerificationEvidence(
    {
      scope: evidence.scope,
      networkGlobalId: evidence.networkGlobalId,
      masterchainSeqno: evidence.masterchainSeqno,
      masterchainRootHash: evidence.masterchainRootHash,
      masterchainFileHash: evidence.masterchainFileHash,
      subjectId: evidence.subjectId,
      proofCompositionHash: evidence.proofCompositionHash,
    },
    policy,
  );
  if (
    recomputed.evidencePolicyId !== evidence.evidencePolicyId ||
    recomputed.evidencePolicyHash !== evidence.evidencePolicyHash ||
    recomputed.verificationEvidenceHash !== evidence.verificationEvidenceHash
  ) {
    reject("verification evidence commitment does not match its policy");
  }
}

export function approveTonVerificationEvidence(
  evidence: TonVerificationEvidence,
  evidencePolicy: TonVerificationEvidencePolicy,
  policy: TonThresholdApprovalPolicy,
  signatures: readonly TonEvidenceSignature[],
): TonApprovedVerificationEvidence {
  const payload = tonEvidenceApprovalSigningPayload(
    evidence,
    evidencePolicy,
    policy,
  );
  const policyHash = approvalPolicyHash(policy);
  if (signatures.length > policy.signers.length) {
    reject("too many approval signatures");
  }
  const signerMap = new Map(policy.signers.map((signer) => [signer.signerId, signer]));
  const seen = new Set<string>();
  const verifiedSigners: string[] = [];
  for (const signature of signatures) {
    requireExactKeys(
      signature,
      ["signerId", "algorithm", "signatureBase64"],
      "approval signature",
    );
    requireIdentifier(signature.signerId, "signature signer ID");
    if (signature.algorithm !== "ed25519") reject("signature algorithm is invalid");
    if (seen.has(signature.signerId)) reject("duplicate approval signature");
    seen.add(signature.signerId);
    const signer = signerMap.get(signature.signerId);
    if (!signer?.enabled) reject(`signature from unauthorized signer ${signature.signerId}`);
    const encoded = Buffer.from(signature.signatureBase64, "base64");
    if (
      !BASE64.test(signature.signatureBase64) ||
      encoded.length !== 64 ||
      encoded.toString("base64") !== signature.signatureBase64
    ) {
      reject(`signature from ${signature.signerId} is malformed`);
    }
    const key = createPublicKey({
      key: Buffer.from(signer.publicKeySpkiDerBase64, "base64"),
      format: "der",
      type: "spki",
    });
    if (!verifySignature(null, payload, key, encoded)) {
      reject(`signature from ${signature.signerId} is invalid`);
    }
    verifiedSigners.push(signature.signerId);
  }
  if (verifiedSigners.length < policy.threshold) {
    reject(
      `approval requires ${policy.threshold} signatures; verified ${verifiedSigners.length}`,
    );
  }
  verifiedSigners.sort();
  const approvalArtifactHash = hashParts("TON_APPROVED_VERIFICATION_EVIDENCE_V1", [
    evidence.verificationEvidenceHash,
    policyHash,
    ...verifiedSigners,
  ]);
  const { remainingRequirement: _remainingRequirement, ...verifiedEvidence } =
    evidence;
  return {
    ...verifiedEvidence,
    kind: "TON_APPROVED_VERIFICATION_EVIDENCE",
    thresholdApprovalVerified: true,
    sealingAuthorized: evidence.scope === "wallet_seal",
    settlementAuthorized: evidence.scope === "settlement_reconciliation",
    authorizationAllowed: true,
    approvalPolicyId: policy.policyId,
    approvalPolicyHash: policyHash,
    approvalThreshold: policy.threshold,
    verifiedSigners,
    approvalArtifactHash,
  };
}
