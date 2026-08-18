import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { verifyReleaseApproval } from "./verify-release-approval";

type JsonObject = Record<string, unknown>;

interface ReleaseCandidate {
  schemaVersion: 1;
  status: "unsigned_release_candidate";
  contract: "TonNativeEscrow";
  sourceRevision: string;
  codeHash: string;
  minOperationalReserveNano: string;
  toolchains: {
    blueprintTolk: string;
    acton: string;
  };
  artifacts: {
    blueprint: { bocSha256: string };
    acton: { bocSha256: string };
  };
  sources: Record<string, string>;
  approvals: {
    required: number;
    signatures: [];
  };
}

interface ApprovedReleaseEvidence {
  schemaVersion: 1;
  status: "approved_release_evidence";
  policyId: string;
  candidateSha256: string;
  sourceRevision: string;
  codeHash: string;
  threshold: number;
  verifiedSigners: string[];
}

interface DeploymentAuthorizationRecord {
  schemaVersion: 1;
  status: "deployment_authorization_request";
  contract: "TonNativeEscrow";
  targetNetwork: "mainnet" | "testnet";
  expectedCandidateSha256: string;
  expectedSourceRevision: string;
  expectedCodeHash: string;
  expectedPolicyId: string;
  expectedApprovalThreshold: number;
  expectedVerifiedSigners: string[];
}

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]{3,128}$/;
const SOURCE_FILES = [
  "Acton.toml",
  "package-lock.json",
  "contracts/TonNativeEscrow.tolk",
  "contracts/types.tolk",
] as const;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function assertExactKeys(
  value: JsonObject,
  expectedKeys: readonly string[],
  label: string,
): void {
  const expected = new Set(expectedKeys);
  const unexpected = Object.keys(value).filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unexpected field ${unexpected[0]}`);
  }
  const missing = expectedKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missing.length > 0) {
    throw new Error(`${label} is missing field ${missing[0]}`);
  }
}

function parseJsonObject(bytes: Buffer, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return assertObject(parsed, label);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertRevision(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function assertIdentifier(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function parseSignerList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error(`${label} must be a non-empty signer list`);
  }
  const signers = value.map((signer, index) => {
    assertIdentifier(signer, `${label}[${index}]`);
    return signer;
  });
  if (new Set(signers).size !== signers.length) {
    throw new Error(`${label} must contain distinct signers`);
  }
  const sorted = [...signers].sort();
  if (sorted.some((signer, index) => signer !== signers[index])) {
    throw new Error(`${label} must be sorted`);
  }
  return signers;
}

function parseCandidate(value: JsonObject): ReleaseCandidate {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "status",
      "contract",
      "sourceRevision",
      "codeHash",
      "minOperationalReserveNano",
      "toolchains",
      "artifacts",
      "sources",
      "approvals",
    ],
    "Release candidate",
  );
  if (
    value.schemaVersion !== 1 ||
    value.status !== "unsigned_release_candidate" ||
    value.contract !== "TonNativeEscrow"
  ) {
    throw new Error("Release candidate identity is invalid");
  }
  assertRevision(value.sourceRevision, "Release candidate source revision");
  assertSha256(value.codeHash, "Release candidate code hash");
  if (
    typeof value.minOperationalReserveNano !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value.minOperationalReserveNano)
  ) {
    throw new Error("Release candidate operational reserve is invalid");
  }

  const toolchains = assertObject(
    value.toolchains,
    "Release candidate toolchains",
  );
  assertExactKeys(
    toolchains,
    ["blueprintTolk", "acton"],
    "Release candidate toolchains",
  );
  if (
    typeof toolchains.blueprintTolk !== "string" ||
    toolchains.blueprintTolk.length === 0 ||
    typeof toolchains.acton !== "string" ||
    toolchains.acton.length === 0
  ) {
    throw new Error("Release candidate toolchains are invalid");
  }

  const artifacts = assertObject(
    value.artifacts,
    "Release candidate artifacts",
  );
  assertExactKeys(
    artifacts,
    ["blueprint", "acton"],
    "Release candidate artifacts",
  );
  for (const name of ["blueprint", "acton"] as const) {
    const artifact = assertObject(
      artifacts[name],
      `Release candidate ${name} artifact`,
    );
    assertExactKeys(
      artifact,
      ["bocSha256"],
      `Release candidate ${name} artifact`,
    );
    assertSha256(
      artifact.bocSha256,
      `Release candidate ${name} artifact BOC digest`,
    );
  }

  const sources = assertObject(value.sources, "Release candidate sources");
  assertExactKeys(sources, SOURCE_FILES, "Release candidate sources");
  for (const source of SOURCE_FILES) {
    assertSha256(sources[source], `Release candidate source ${source}`);
  }

  const approvals = assertObject(
    value.approvals,
    "Release candidate approvals",
  );
  assertExactKeys(
    approvals,
    ["required", "signatures"],
    "Release candidate approvals",
  );
  if (
    !Number.isSafeInteger(approvals.required) ||
    (approvals.required as number) < 2 ||
    !Array.isArray(approvals.signatures) ||
    approvals.signatures.length !== 0
  ) {
    throw new Error("Release candidate approvals are not pristine");
  }
  return value as unknown as ReleaseCandidate;
}

function parseApproval(value: JsonObject): ApprovedReleaseEvidence {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "status",
      "policyId",
      "candidateSha256",
      "sourceRevision",
      "codeHash",
      "threshold",
      "verifiedSigners",
    ],
    "Approved release evidence",
  );
  if (
    value.schemaVersion !== 1 ||
    value.status !== "approved_release_evidence"
  ) {
    throw new Error("Approved release evidence identity is invalid");
  }
  assertIdentifier(value.policyId, "Approved release evidence policy ID");
  assertSha256(
    value.candidateSha256,
    "Approved release evidence candidate digest",
  );
  assertRevision(
    value.sourceRevision,
    "Approved release evidence source revision",
  );
  assertSha256(value.codeHash, "Approved release evidence code hash");
  if (
    !Number.isSafeInteger(value.threshold) ||
    (value.threshold as number) < 2
  ) {
    throw new Error("Approved release evidence threshold is invalid");
  }
  const signers = parseSignerList(
    value.verifiedSigners,
    "Approved release evidence verified signers",
  );
  if (signers.length < (value.threshold as number)) {
    throw new Error(
      "Approved release evidence has fewer signers than its threshold",
    );
  }
  return value as unknown as ApprovedReleaseEvidence;
}

function parseDeploymentRecord(
  value: JsonObject,
): DeploymentAuthorizationRecord {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "status",
      "contract",
      "targetNetwork",
      "expectedCandidateSha256",
      "expectedSourceRevision",
      "expectedCodeHash",
      "expectedPolicyId",
      "expectedApprovalThreshold",
      "expectedVerifiedSigners",
    ],
    "Deployment authorization record",
  );
  if (
    value.schemaVersion !== 1 ||
    value.status !== "deployment_authorization_request" ||
    value.contract !== "TonNativeEscrow" ||
    (value.targetNetwork !== "mainnet" && value.targetNetwork !== "testnet")
  ) {
    throw new Error("Deployment authorization record identity is invalid");
  }
  assertSha256(
    value.expectedCandidateSha256,
    "Deployment authorization record expected candidate digest",
  );
  assertRevision(
    value.expectedSourceRevision,
    "Deployment authorization record expected source revision",
  );
  assertSha256(
    value.expectedCodeHash,
    "Deployment authorization record expected code hash",
  );
  assertIdentifier(
    value.expectedPolicyId,
    "Deployment authorization record expected policy ID",
  );
  if (
    !Number.isSafeInteger(value.expectedApprovalThreshold) ||
    (value.expectedApprovalThreshold as number) < 2
  ) {
    throw new Error("Deployment authorization record threshold is invalid");
  }
  parseSignerList(
    value.expectedVerifiedSigners,
    "Deployment authorization record expected verified signers",
  );
  return value as unknown as DeploymentAuthorizationRecord;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} does not match`);
  }
}

async function writeAtomic(
  outputPath: string,
  contents: string,
): Promise<void> {
  const outputDirectory = dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true });
  const temporaryPath = resolve(
    outputDirectory,
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, outputPath);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) {
      await rm(temporaryPath, { force: true });
    }
  }
}

export async function authorizeDeployment(input: {
  candidatePath: string;
  approvalPath: string;
  policyPath: string;
  signaturesPath: string;
  deploymentRecordPath: string;
  outputPath: string;
}) {
  const candidateBytes = await readFile(input.candidatePath);
  const approvalBytes = await readFile(input.approvalPath);
  const deploymentRecordBytes = await readFile(input.deploymentRecordPath);
  const candidate = parseCandidate(
    parseJsonObject(candidateBytes, "Release candidate"),
  );
  const approval = parseApproval(
    parseJsonObject(approvalBytes, "Approved release evidence"),
  );
  const deploymentRecord = parseDeploymentRecord(
    parseJsonObject(deploymentRecordBytes, "Deployment authorization record"),
  );
  const candidateSha256 = sha256(candidateBytes);

  assertEqual(
    approval.candidateSha256,
    candidateSha256,
    "Approval candidate digest",
  );
  assertEqual(
    deploymentRecord.expectedCandidateSha256,
    candidateSha256,
    "Expected candidate digest",
  );
  assertEqual(
    approval.sourceRevision,
    candidate.sourceRevision,
    "Approval source revision",
  );
  assertEqual(
    deploymentRecord.expectedSourceRevision,
    candidate.sourceRevision,
    "Expected source revision",
  );
  assertEqual(approval.codeHash, candidate.codeHash, "Approval code hash");
  assertEqual(
    deploymentRecord.expectedCodeHash,
    candidate.codeHash,
    "Expected code hash",
  );
  assertEqual(
    approval.threshold,
    candidate.approvals.required,
    "Approval threshold",
  );
  assertEqual(
    deploymentRecord.expectedApprovalThreshold,
    approval.threshold,
    "Expected approval threshold",
  );
  assertEqual(
    deploymentRecord.expectedPolicyId,
    approval.policyId,
    "Expected approval policy",
  );
  if (!approval.policyId.startsWith(`ton-${deploymentRecord.targetNetwork}-`)) {
    throw new Error("Approval policy is not bound to the target network");
  }
  if (
    deploymentRecord.expectedVerifiedSigners.length !==
      approval.verifiedSigners.length ||
    deploymentRecord.expectedVerifiedSigners.some(
      (signer, index) => signer !== approval.verifiedSigners[index],
    )
  ) {
    throw new Error("Expected verified signer binding does not match");
  }

  // Re-run threshold verification over a private copy so concurrent changes to
  // candidatePath cannot make structural and cryptographic checks observe
  // different candidate bytes. This verifier reads public keys only.
  const verificationDirectory = await mkdtemp(
    resolve(tmpdir(), "ton-deployment-authorization-"),
  );
  const verificationCandidatePath = resolve(
    verificationDirectory,
    "release-candidate.json",
  );
  const verificationEvidencePath = resolve(
    verificationDirectory,
    "release-approval.json",
  );
  let cryptographicApproval: Awaited<ReturnType<typeof verifyReleaseApproval>>;
  try {
    await writeFile(verificationCandidatePath, candidateBytes, {
      flag: "wx",
      mode: 0o600,
    });
    cryptographicApproval = await verifyReleaseApproval({
      candidatePath: verificationCandidatePath,
      policyPath: input.policyPath,
      signaturesPath: input.signaturesPath,
      outputPath: verificationEvidencePath,
    });
  } finally {
    await rm(verificationEvidencePath, { force: true });
    await rm(verificationCandidatePath, { force: true });
    await rmdir(verificationDirectory);
  }

  const cryptographicFieldsMatch =
    approval.policyId === cryptographicApproval.policyId &&
    approval.candidateSha256 === cryptographicApproval.candidateSha256 &&
    approval.sourceRevision === cryptographicApproval.sourceRevision &&
    approval.codeHash === cryptographicApproval.codeHash &&
    approval.threshold === cryptographicApproval.threshold &&
    approval.verifiedSigners.length ===
      cryptographicApproval.verifiedSigners.length &&
    approval.verifiedSigners.every(
      (signer, index) =>
        signer === cryptographicApproval.verifiedSigners[index],
    );
  if (!cryptographicFieldsMatch) {
    throw new Error(
      "Provided approval evidence does not match cryptographic verification",
    );
  }

  const authorization = {
    schemaVersion: 1,
    status: "validated_deployment_input",
    contract: candidate.contract,
    targetNetwork: deploymentRecord.targetNetwork,
    candidateSha256,
    deploymentRecordSha256: sha256(deploymentRecordBytes),
    sourceRevision: candidate.sourceRevision,
    codeHash: candidate.codeHash,
    policyId: approval.policyId,
    approvalThreshold: approval.threshold,
    verifiedSigners: approval.verifiedSigners,
  } as const;
  await writeAtomic(
    input.outputPath,
    `${JSON.stringify(authorization, null, 2)}\n`,
  );
  return authorization;
}

async function main(): Promise<void> {
  const authorization = await authorizeDeployment({
    candidatePath: resolve(
      process.argv[2] ?? "build/TonNativeEscrow.release-candidate.json",
    ),
    approvalPath: resolve(
      process.argv[3] ?? "build/TonNativeEscrow.release-approval.json",
    ),
    policyPath: resolve(process.argv[4] ?? "release-policy.json"),
    signaturesPath: resolve(process.argv[5] ?? "build/release-signatures.json"),
    deploymentRecordPath: resolve(
      process.argv[6] ?? "deployment-authorization.json",
    ),
    outputPath: resolve(
      process.argv[7] ?? "build/TonNativeEscrow.deployment-input.json",
    ),
  });
  process.stdout.write(
    `Authorized ${authorization.contract} input for ${authorization.targetNetwork} at ${authorization.codeHash}\n`,
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
