import {
  createHash,
  createPublicKey,
  KeyObject,
  verify as verifySignature,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface ReleaseCandidate {
  schemaVersion: number;
  status: string;
  contract: string;
  sourceRevision: string | null;
  codeHash: string;
  approvals: { required: number; signatures: unknown[] };
}

interface ReleaseSigner {
  id: string;
  algorithm: "ed25519";
  publicKeyPem: string;
  enabled: boolean;
}

interface ReleasePolicy {
  schemaVersion: number;
  policyId: string;
  threshold: number;
  signers: ReleaseSigner[];
}

interface ReleaseSignatures {
  schemaVersion: number;
  policyId: string;
  candidateSha256: string;
  signatures: Array<{
    signerId: string;
    algorithm: "ed25519";
    signatureBase64: string;
  }>;
}

type JsonObject = Record<string, unknown>;

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]{3,128}$/;
const ED25519_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertJsonObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function assertExactKeys(
  value: JsonObject,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unexpected field ${unexpected[0]}`);
  }
}

function parseJsonObject(bytes: Buffer | string, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString());
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return assertJsonObject(parsed, label);
}

function parseCandidate(value: JsonObject): ReleaseCandidate {
  const approvals = assertJsonObject(
    value.approvals,
    "Release candidate approvals",
  );
  assertExactKeys(
    approvals,
    ["required", "signatures"],
    "Release candidate approvals",
  );
  if (
    value.schemaVersion !== 1 ||
    value.status !== "unsigned_release_candidate" ||
    value.contract !== "TonNativeEscrow" ||
    typeof value.sourceRevision !== "string" ||
    value.sourceRevision.length === 0 ||
    value.sourceRevision.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value.sourceRevision) ||
    typeof value.codeHash !== "string" ||
    !Number.isInteger(approvals.required) ||
    (approvals.required as number) < 2 ||
    !Array.isArray(approvals.signatures) ||
    approvals.signatures.length !== 0
  ) {
    throw new Error("Release candidate is incomplete or is not pristine");
  }
  assertSha256(value.codeHash, "Candidate code hash");
  return value as unknown as ReleaseCandidate;
}

function parsePolicy(value: JsonObject): ReleasePolicy {
  assertExactKeys(
    value,
    ["schemaVersion", "policyId", "threshold", "signers"],
    "Release policy",
  );
  if (
    value.schemaVersion !== 1 ||
    typeof value.policyId !== "string" ||
    !IDENTIFIER_PATTERN.test(value.policyId) ||
    !Number.isInteger(value.threshold) ||
    (value.threshold as number) < 2 ||
    !Array.isArray(value.signers) ||
    value.signers.length > 256
  ) {
    throw new Error("Release policy is invalid or below two-person control");
  }
  return value as unknown as ReleasePolicy;
}

function parseSignatureBundle(value: JsonObject): ReleaseSignatures {
  assertExactKeys(
    value,
    ["schemaVersion", "policyId", "candidateSha256", "signatures"],
    "Signature bundle",
  );
  if (
    value.schemaVersion !== 1 ||
    typeof value.policyId !== "string" ||
    typeof value.candidateSha256 !== "string" ||
    !Array.isArray(value.signatures) ||
    value.signatures.length > 256
  ) {
    throw new Error("Signature bundle is malformed");
  }
  assertSha256(value.candidateSha256, "Signature bundle candidate digest");
  return value as unknown as ReleaseSignatures;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function readEd25519Key(pem: string, signerId: string): KeyObject {
  if (/PRIVATE KEY/.test(pem)) {
    throw new Error(`Signer ${signerId} must contain only a public key`);
  }
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new Error(`Signer ${signerId} has an invalid public key`);
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Signer ${signerId} must use an Ed25519 public key`);
  }
  return key;
}

export function releaseApprovalPayload(
  policyId: string,
  candidateSha256: string,
): Buffer {
  return Buffer.from(
    `telegram-garant-ton-release-v1\n${policyId}\n${candidateSha256}\n`,
    "utf8",
  );
}

export async function verifyReleaseApproval(input: {
  candidatePath: string;
  policyPath: string;
  signaturesPath: string;
  outputPath: string;
}) {
  const candidateBytes = await readFile(input.candidatePath);
  const candidate = parseCandidate(
    parseJsonObject(candidateBytes, "Release candidate"),
  );
  const policy = parsePolicy(
    parseJsonObject(await readFile(input.policyPath), "Release policy"),
  );
  const signatures = parseSignatureBundle(
    parseJsonObject(await readFile(input.signaturesPath), "Signature bundle"),
  );
  const candidateSha256 = sha256(candidateBytes);

  if (candidate.approvals.required !== policy.threshold) {
    throw new Error("Release candidate and policy thresholds differ");
  }
  const signerMap = new Map<
    string,
    { signer: ReleaseSigner; key: KeyObject }
  >();
  for (const rawSigner of policy.signers as unknown[]) {
    const signerObject = assertJsonObject(rawSigner, "Release policy signer");
    assertExactKeys(
      signerObject,
      ["id", "algorithm", "publicKeyPem", "enabled"],
      "Release policy signer",
    );
    if (
      typeof signerObject.id !== "string" ||
      !IDENTIFIER_PATTERN.test(signerObject.id) ||
      signerObject.algorithm !== "ed25519" ||
      typeof signerObject.publicKeyPem !== "string" ||
      typeof signerObject.enabled !== "boolean"
    ) {
      throw new Error("Release policy contains an invalid signer");
    }
    const signer = signerObject as unknown as ReleaseSigner;
    if (signerMap.has(signer.id)) {
      throw new Error("Release policy contains a duplicate signer");
    }
    signerMap.set(signer.id, {
      signer,
      key: readEd25519Key(signer.publicKeyPem, signer.id),
    });
  }
  const enabledSigners = [...signerMap.values()].filter(
    ({ signer }) => signer.enabled,
  );
  if (policy.threshold > enabledSigners.length) {
    throw new Error("Release threshold exceeds enabled signer count");
  }

  if (
    signatures.schemaVersion !== 1 ||
    signatures.policyId !== policy.policyId ||
    signatures.candidateSha256 !== candidateSha256 ||
    !Array.isArray(signatures.signatures)
  ) {
    throw new Error("Signature bundle does not match policy and candidate");
  }
  const payload = releaseApprovalPayload(policy.policyId, candidateSha256);
  const verifiedSigners: string[] = [];
  const seen = new Set<string>();
  for (const rawSignature of signatures.signatures as unknown[]) {
    const signatureObject = assertJsonObject(rawSignature, "Release signature");
    assertExactKeys(
      signatureObject,
      ["signerId", "algorithm", "signatureBase64"],
      "Release signature",
    );
    if (
      typeof signatureObject.signerId !== "string" ||
      !IDENTIFIER_PATTERN.test(signatureObject.signerId) ||
      typeof signatureObject.algorithm !== "string" ||
      typeof signatureObject.signatureBase64 !== "string"
    ) {
      throw new Error("Release signature is malformed");
    }
    const signature =
      signatureObject as unknown as ReleaseSignatures["signatures"][number];
    if (seen.has(signature.signerId)) {
      throw new Error(`Duplicate signature from ${signature.signerId}`);
    }
    seen.add(signature.signerId);
    const configured = signerMap.get(signature.signerId);
    if (
      !configured ||
      !configured.signer.enabled ||
      signature.algorithm !== "ed25519"
    ) {
      throw new Error(
        `Signature from unauthorized signer ${signature.signerId}`,
      );
    }
    if (
      !signature.signatureBase64 ||
      !ED25519_SIGNATURE_PATTERN.test(signature.signatureBase64)
    ) {
      throw new Error(`Invalid signature from ${signature.signerId}`);
    }
    const encoded = Buffer.from(signature.signatureBase64, "base64");
    if (
      encoded.length !== 64 ||
      encoded.toString("base64") !== signature.signatureBase64 ||
      !verifySignature(null, payload, configured.key, encoded)
    ) {
      throw new Error(`Invalid signature from ${signature.signerId}`);
    }
    verifiedSigners.push(signature.signerId);
  }
  if (verifiedSigners.length < policy.threshold) {
    throw new Error(
      `Release approval requires ${policy.threshold} signatures; verified ${verifiedSigners.length}`,
    );
  }

  verifiedSigners.sort();
  const approval = {
    schemaVersion: 1,
    status: "approved_release_evidence",
    policyId: policy.policyId,
    candidateSha256,
    sourceRevision: candidate.sourceRevision,
    codeHash: candidate.codeHash,
    threshold: policy.threshold,
    verifiedSigners,
  };
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(
    input.outputPath,
    `${JSON.stringify(approval, null, 2)}\n`,
    "utf8",
  );
  return approval;
}

async function main() {
  const approval = await verifyReleaseApproval({
    candidatePath: resolve(
      process.argv[2] ?? "build/TonNativeEscrow.release-candidate.json",
    ),
    policyPath: resolve(process.argv[3] ?? "release-policy.json"),
    signaturesPath: resolve(process.argv[4] ?? "build/release-signatures.json"),
    outputPath: resolve(
      process.argv[5] ?? "build/TonNativeEscrow.release-approval.json",
    ),
  });
  process.stdout.write(
    `Verified ${approval.verifiedSigners.length}-signer approval for ${approval.codeHash}\n`,
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
