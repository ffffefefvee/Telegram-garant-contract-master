import { createHash } from "node:crypto";
import { Cell } from "@ton/ton";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const BOC_HEX = /^[0-9a-f]+$/;
const NANO_AMOUNT = /^(0|[1-9][0-9]*)$/;
export const TON_NATIVE_MIN_OPERATIONAL_RESERVE = 200_000_000n;

export interface TonEscrowArtifactStatus {
  verified: boolean;
  reason: string;
  codeHash?: string;
  compilerVersion?: string;
  bocHex?: string;
  minOperationalReserveNano?: string;
}

interface TonEscrowArtifact {
  contract: string;
  sourceLanguage: string;
  compilerVersion: string;
  codeHash: string;
  bocSha256: string;
  bocHex: string;
  minOperationalReserveNano: string;
}

/**
 * Verifies the exact release file and its BOC bytes without trusting either
 * hash declared inside the JSON. The expected file digest and code-cell hash
 * must come from independently approved release configuration.
 */
export function verifyTonEscrowArtifact(
  rawArtifact: Buffer,
  expectedFileSha256: string,
  expectedCodeHash: string,
): TonEscrowArtifactStatus {
  const fileSha256 = createHash("sha256").update(rawArtifact).digest("hex");
  const normalizedFileHash = expectedFileSha256.trim().toLowerCase();
  const normalizedCodeHash = expectedCodeHash.trim().toLowerCase();

  if (
    !SHA256_HEX.test(normalizedFileHash) ||
    fileSha256 !== normalizedFileHash
  ) {
    return { verified: false, reason: "artifact_file_hash_mismatch" };
  }
  if (!SHA256_HEX.test(normalizedCodeHash)) {
    return { verified: false, reason: "invalid_expected_code_hash" };
  }

  let artifact: TonEscrowArtifact;
  try {
    artifact = JSON.parse(rawArtifact.toString("utf8")) as TonEscrowArtifact;
  } catch {
    return { verified: false, reason: "artifact_json_invalid" };
  }

  const artifactCodeHash = String(artifact.codeHash ?? "").toLowerCase();
  const declaredBocHash = String(artifact.bocSha256 ?? "").toLowerCase();
  const bocHex = String(artifact.bocHex ?? "").toLowerCase();
  if (
    artifact.contract !== "TonNativeEscrow" ||
    artifact.sourceLanguage !== "tolk" ||
    typeof artifact.compilerVersion !== "string" ||
    artifact.compilerVersion.length === 0 ||
    !SHA256_HEX.test(artifactCodeHash) ||
    !SHA256_HEX.test(declaredBocHash) ||
    !BOC_HEX.test(bocHex) ||
    bocHex.length % 2 !== 0 ||
    !NANO_AMOUNT.test(String(artifact.minOperationalReserveNano ?? ""))
  ) {
    return { verified: false, reason: "artifact_schema_invalid" };
  }

  const actualBocHash = createHash("sha256")
    .update(Buffer.from(bocHex, "hex"))
    .digest("hex");
  if (actualBocHash !== declaredBocHash) {
    return { verified: false, reason: "artifact_boc_hash_mismatch" };
  }
  let codeCell: Cell;
  try {
    const roots = Cell.fromBoc(Buffer.from(bocHex, "hex"));
    if (roots.length !== 1) {
      return { verified: false, reason: "artifact_boc_root_count_invalid" };
    }
    codeCell = roots[0];
  } catch {
    return { verified: false, reason: "artifact_boc_invalid" };
  }
  if (codeCell.hash().toString("hex") !== artifactCodeHash) {
    return { verified: false, reason: "artifact_code_cell_hash_mismatch" };
  }
  if (artifactCodeHash !== normalizedCodeHash) {
    return { verified: false, reason: "artifact_code_hash_mismatch" };
  }
  if (
    BigInt(artifact.minOperationalReserveNano) !==
    TON_NATIVE_MIN_OPERATIONAL_RESERVE
  ) {
    return { verified: false, reason: "artifact_operational_reserve_mismatch" };
  }

  return {
    verified: true,
    reason: "verified",
    codeHash: artifactCodeHash,
    compilerVersion: artifact.compilerVersion,
    bocHex,
    minOperationalReserveNano: artifact.minOperationalReserveNano,
  };
}
