import { createHash } from "crypto";
import { Cell, CellType } from "@ton/core";
import { verifyTonMasterchainHeaderCell } from "./ton-masterchain-header-proof";
import type { TonProvenMasterchainHeader } from "./ton-masterchain-header-proof";

export type TonProofNetwork = "mainnet" | "testnet";

export interface TonProofBlockId {
  workchain: number;
  shard: string;
  seqno: number;
  rootHash: string;
  fileHash: string;
}

export interface TonProofResourceLimits {
  maxBocBytes: number;
  maxCells: number;
  maxDepth: number;
}

export interface TonTrustedNetworkConfig {
  policyVersion: string;
  network: TonProofNetwork;
  globalId: number;
  zeroState: TonProofBlockId;
  trustedKeyBlock: TonProofBlockId;
  maxProofAgeSeconds: number;
  maxFutureSkewSeconds: number;
  limits: TonProofResourceLimits;
}

export interface TonRawProofs {
  masterchainBlockProofBocBase64: string;
  shardDescriptorProofBocBase64: string;
  shardBlockProofBocBase64: string;
  masterAccountProofBocBase64: string;
  walletAccountProofBocBase64: string;
}

export interface TonProofBundle {
  network: TonProofNetwork;
  observedAtUnix: number;
  targetMasterchainBlock: TonProofBlockId;
  proofs: TonRawProofs;
}

export type TonProofEnvelopeReasonCode =
  | "INVALID_TRUSTED_CONFIG"
  | "INVALID_PROOF_BUNDLE"
  | "STALE_PROOF_BUNDLE"
  | "CRYPTOGRAPHIC_VERIFICATION_REQUIRED";

export interface TonProofEnvelopeResult {
  accepted: false;
  proofsVerified: false;
  authorizationAllowed: false;
  structuralChecksPassed: boolean;
  reasonCode: TonProofEnvelopeReasonCode;
  detail: string;
  structuralEvidenceHash: string | null;
  verificationEvidenceHash: null;
  remainingChecks: readonly string[];
}

const MASTERCHAIN_SHARD = "-9223372036854775808";
const NETWORK_GLOBAL_IDS: Record<TonProofNetwork, number> = {
  mainnet: -239,
  testnet: -3,
};
const PROOF_KEYS = [
  "masterchainBlockProofBocBase64",
  "shardDescriptorProofBocBase64",
  "shardBlockProofBocBase64",
  "masterAccountProofBocBase64",
  "walletAccountProofBocBase64",
] as const;
const REMAINING_CHECKS = [
  "TRUSTED_MASTERCHAIN_SIGNATURE_CHAIN",
  "VERIFIED_MASTERCHAIN_BLOCK_PROOF",
  "VERIFIED_SHARD_DESCRIPTOR_INCLUSION",
  "VERIFIED_SHARD_BLOCK_PROOF",
  "VERIFIED_ACCOUNT_STATE_PROOFS",
  "LOCAL_GET_WALLET_ADDRESS_EXECUTION",
] as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

interface BocHeader {
  cells: number;
  roots: number;
  absent: number;
  expectedBytes: number;
  size: number;
  cellDataOffset: number;
  totalCellSize: number;
}

interface ParsedProof {
  bocHash: string;
  rootHash: string;
  virtualRootHash: string;
  cells: number;
  depth: number;
  virtualRoot: Cell;
  masterchainHeader?: TonProvenMasterchainHeader;
}

class EnvelopeValidationError extends Error {
  constructor(
    readonly reasonCode: Exclude<
      TonProofEnvelopeReasonCode,
      "CRYPTOGRAPHIC_VERIFICATION_REQUIRED"
    >,
    message: string,
  ) {
    super(message);
  }
}

function fail(
  reasonCode: Exclude<
    TonProofEnvelopeReasonCode,
    "CRYPTOGRAPHIC_VERIFICATION_REQUIRED"
  >,
  detail: string,
): TonProofEnvelopeResult {
  return {
    accepted: false,
    proofsVerified: false,
    authorizationAllowed: false,
    structuralChecksPassed: false,
    reasonCode,
    detail,
    structuralEvidenceHash: null,
    verificationEvidenceHash: null,
    remainingChecks: REMAINING_CHECKS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
  reasonCode: "INVALID_TRUSTED_CONFIG" | "INVALID_PROOF_BUNDLE",
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new EnvelopeValidationError(reasonCode, `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new EnvelopeValidationError(
      reasonCode,
      `${label} must contain exactly: ${expected.join(", ")}`,
    );
  }
}

function requireInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
  reasonCode: "INVALID_TRUSTED_CONFIG" | "INVALID_PROOF_BUNDLE",
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new EnvelopeValidationError(reasonCode, `${label} is out of range`);
  }
  return value;
}

function validateBlockId(
  value: unknown,
  label: string,
  reasonCode: "INVALID_TRUSTED_CONFIG" | "INVALID_PROOF_BUNDLE",
): TonProofBlockId {
  requireExactKeys(
    value,
    ["workchain", "shard", "seqno", "rootHash", "fileHash"],
    label,
    reasonCode,
  );
  const workchain = requireInteger(
    value.workchain,
    -1,
    0,
    `${label}.workchain`,
    reasonCode,
  );
  const seqno = requireInteger(
    value.seqno,
    0,
    0xffffffff,
    `${label}.seqno`,
    reasonCode,
  );
  if (
    typeof value.shard !== "string" ||
    !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value.shard)
  ) {
    throw new EnvelopeValidationError(
      reasonCode,
      `${label}.shard is not canonical`,
    );
  }
  try {
    const shard = BigInt(value.shard);
    if (shard < -(1n << 63n) || shard > (1n << 63n) - 1n) {
      throw new Error("range");
    }
  } catch {
    throw new EnvelopeValidationError(
      reasonCode,
      `${label}.shard is out of range`,
    );
  }
  if (
    typeof value.rootHash !== "string" ||
    !HASH_PATTERN.test(value.rootHash) ||
    value.rootHash === "0".repeat(64) ||
    typeof value.fileHash !== "string" ||
    !HASH_PATTERN.test(value.fileHash) ||
    value.fileHash === "0".repeat(64)
  ) {
    throw new EnvelopeValidationError(
      reasonCode,
      `${label} hashes are invalid`,
    );
  }
  return {
    workchain,
    shard: value.shard,
    seqno,
    rootHash: value.rootHash,
    fileHash: value.fileHash,
  };
}

function validateMasterchainBlock(
  block: TonProofBlockId,
  label: string,
  reasonCode: "INVALID_TRUSTED_CONFIG" | "INVALID_PROOF_BUNDLE",
): void {
  if (block.workchain !== -1 || block.shard !== MASTERCHAIN_SHARD) {
    throw new EnvelopeValidationError(
      reasonCode,
      `${label} is not a masterchain block`,
    );
  }
}

function validateTrustedConfig(value: unknown): TonTrustedNetworkConfig {
  const reasonCode = "INVALID_TRUSTED_CONFIG" as const;
  requireExactKeys(
    value,
    [
      "policyVersion",
      "network",
      "globalId",
      "zeroState",
      "trustedKeyBlock",
      "maxProofAgeSeconds",
      "maxFutureSkewSeconds",
      "limits",
    ],
    "trusted config",
    reasonCode,
  );
  if (value.network !== "mainnet" && value.network !== "testnet") {
    throw new EnvelopeValidationError(reasonCode, "network is invalid");
  }
  if (
    typeof value.policyVersion !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.policyVersion)
  ) {
    throw new EnvelopeValidationError(reasonCode, "policyVersion is invalid");
  }
  if (value.globalId !== NETWORK_GLOBAL_IDS[value.network]) {
    throw new EnvelopeValidationError(
      reasonCode,
      "globalId does not match the trusted network",
    );
  }
  const zeroState = validateBlockId(value.zeroState, "zeroState", reasonCode);
  const trustedKeyBlock = validateBlockId(
    value.trustedKeyBlock,
    "trustedKeyBlock",
    reasonCode,
  );
  validateMasterchainBlock(zeroState, "zeroState", reasonCode);
  validateMasterchainBlock(trustedKeyBlock, "trustedKeyBlock", reasonCode);
  if (zeroState.seqno !== 0 || trustedKeyBlock.seqno === 0) {
    throw new EnvelopeValidationError(
      reasonCode,
      "trusted anchors have invalid sequence numbers",
    );
  }
  const maxProofAgeSeconds = requireInteger(
    value.maxProofAgeSeconds,
    1,
    86400,
    "maxProofAgeSeconds",
    reasonCode,
  );
  const maxFutureSkewSeconds = requireInteger(
    value.maxFutureSkewSeconds,
    0,
    3600,
    "maxFutureSkewSeconds",
    reasonCode,
  );
  requireExactKeys(
    value.limits,
    ["maxBocBytes", "maxCells", "maxDepth"],
    "limits",
    reasonCode,
  );
  const limits = {
    maxBocBytes: requireInteger(
      value.limits.maxBocBytes,
      1,
      16 * 1024 * 1024,
      "limits.maxBocBytes",
      reasonCode,
    ),
    maxCells: requireInteger(
      value.limits.maxCells,
      1,
      1_000_000,
      "limits.maxCells",
      reasonCode,
    ),
    maxDepth: requireInteger(
      value.limits.maxDepth,
      1,
      1024,
      "limits.maxDepth",
      reasonCode,
    ),
  };
  return {
    policyVersion: value.policyVersion,
    network: value.network,
    globalId: value.globalId,
    zeroState,
    trustedKeyBlock,
    maxProofAgeSeconds,
    maxFutureSkewSeconds,
    limits,
  };
}

function readUnsigned(buffer: Buffer, offset: number, bytes: number): number {
  if (bytes < 1 || bytes > 6 || offset + bytes > buffer.length) {
    throw new Error("invalid integer width");
  }
  let value = 0;
  for (let index = 0; index < bytes; index += 1) {
    value = value * 256 + buffer[offset + index];
  }
  if (!Number.isSafeInteger(value)) throw new Error("unsafe integer");
  return value;
}

function addChecked(...values: number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("invalid size");
    total += value;
    if (!Number.isSafeInteger(total)) throw new Error("unsafe size");
  }
  return total;
}

function multiplyChecked(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("unsafe size");
  return result;
}

function parseBocHeader(buffer: Buffer): BocHeader {
  if (buffer.length < 6) throw new Error("BOC header is truncated");
  const magic = buffer.readUInt32BE(0);
  let size: number;
  let offBytes: number;
  let cursor = 4;
  let hasIndex: boolean;
  let hasCrc: boolean;
  let generic = false;
  if (magic === 0xb5ee9c72) {
    generic = true;
    const flags = buffer[cursor];
    cursor += 1;
    hasIndex = (flags & 0x80) !== 0;
    hasCrc = (flags & 0x40) !== 0;
    if ((flags & 0x20) !== 0 || (flags & 0x18) !== 0) {
      throw new Error("unsupported BOC flags");
    }
    size = flags & 0x07;
    offBytes = buffer[cursor];
    cursor += 1;
  } else if (magic === 0x68ff65f3 || magic === 0xacc3a728) {
    hasIndex = true;
    hasCrc = magic === 0xacc3a728;
    size = buffer[cursor];
    offBytes = buffer[cursor + 1];
    cursor += 2;
  } else {
    throw new Error("invalid BOC magic");
  }
  if (size < 1 || size > 6 || offBytes < 1 || offBytes > 6) {
    throw new Error("invalid BOC integer widths");
  }
  const fixedFieldsEnd = addChecked(cursor, 3 * size, offBytes);
  if (fixedFieldsEnd > buffer.length)
    throw new Error("BOC header is truncated");
  const cells = readUnsigned(buffer, cursor, size);
  cursor += size;
  const roots = readUnsigned(buffer, cursor, size);
  cursor += size;
  const absent = readUnsigned(buffer, cursor, size);
  cursor += size;
  const totalCellSize = readUnsigned(buffer, cursor, offBytes);
  cursor += offBytes;
  const rootIndexBytes = generic ? multiplyChecked(roots, size) : 0;
  const indexBytes = hasIndex ? multiplyChecked(cells, offBytes) : 0;
  const cellDataOffset = addChecked(cursor, rootIndexBytes, indexBytes);
  const expectedBytes = addChecked(
    cellDataOffset,
    totalCellSize,
    hasCrc ? 4 : 0,
  );
  return {
    cells,
    roots,
    absent,
    expectedBytes,
    size,
    cellDataOffset,
    totalCellSize,
  };
}

function countCellHashes(levelMask: number): number {
  let mask = levelMask & 0x07;
  let count = 1;
  for (let index = 0; index < 3; index += 1) {
    count += mask & 1;
    mask >>= 1;
  }
  return count;
}

function validateCellDataConsumption(buffer: Buffer, header: BocHeader): void {
  let cursor = header.cellDataOffset;
  const end = addChecked(header.cellDataOffset, header.totalCellSize);
  for (let index = 0; index < header.cells; index += 1) {
    if (cursor + 2 > end) throw new Error("BOC cell data is truncated");
    const refsDescriptor = buffer[cursor];
    const bitsDescriptor = buffer[cursor + 1];
    cursor += 2;
    const refs = refsDescriptor & 0x07;
    if (refs > 4) throw new Error("BOC cell has too many references");
    const levelMask = refsDescriptor >> 5;
    const hashes =
      (refsDescriptor & 0x10) !== 0 ? countCellHashes(levelMask) : 0;
    const payloadBytes = Math.ceil(bitsDescriptor / 2);
    cursor = addChecked(
      cursor,
      multiplyChecked(hashes, 34),
      payloadBytes,
      multiplyChecked(refs, header.size),
    );
    if (cursor > end) throw new Error("BOC cell data is truncated");
  }
  if (cursor !== end) throw new Error("BOC cell data contains unused bytes");
}

function decodeCanonicalBase64(
  value: unknown,
  maxBytes: number,
  label: string,
): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(value)
  ) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} is not canonical base64`,
    );
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedBytes = (value.length / 4) * 3 - padding;
  if (decodedBytes > maxBytes) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} exceeds the byte limit`,
    );
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.toString("base64") !== value) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} is not canonical base64`,
    );
  }
  if (buffer.length > maxBytes) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} exceeds the byte limit`,
    );
  }
  return buffer;
}

function parseMerkleProof(
  value: unknown,
  limits: TonProofResourceLimits,
  label: string,
): ParsedProof {
  const buffer = decodeCanonicalBase64(value, limits.maxBocBytes, label);
  let header: BocHeader;
  let roots: Cell[];
  try {
    header = parseBocHeader(buffer);
    if (header.expectedBytes !== buffer.length) {
      throw new Error("BOC has trailing or missing bytes");
    }
    if (header.cells < 1 || header.cells > limits.maxCells) {
      throw new Error("BOC cell count is out of range");
    }
    if (header.roots !== 1 || header.absent !== 0) {
      throw new Error("BOC must contain one complete root");
    }
    validateCellDataConsumption(buffer, header);
    roots = Cell.fromBoc(buffer);
  } catch (error) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const root = roots[0];
  if (roots.length !== 1 || root.type !== CellType.MerkleProof) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} must have one MerkleProof root`,
    );
  }
  const depth = root.depth();
  if (depth > limits.maxDepth) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} exceeds the depth limit`,
    );
  }
  const slice = root.beginParse(true);
  const type = slice.loadUint(8);
  const virtualRootHash = slice.loadBuffer(32).toString("hex");
  slice.loadUint(16);
  const virtualRoot = slice.loadRef();
  slice.endParse();
  if (type !== CellType.MerkleProof) {
    throw new EnvelopeValidationError(
      "INVALID_PROOF_BUNDLE",
      `${label} has an invalid MerkleProof descriptor`,
    );
  }
  return {
    bocHash: createHash("sha256").update(buffer).digest("hex"),
    rootHash: root.hash().toString("hex"),
    virtualRootHash,
    cells: header.cells,
    depth,
    virtualRoot,
  };
}

function validateBundle(
  value: unknown,
  config: TonTrustedNetworkConfig,
  nowUnix: number,
): { bundle: TonProofBundle; parsedProofs: Record<string, ParsedProof> } {
  const reasonCode = "INVALID_PROOF_BUNDLE" as const;
  requireExactKeys(
    value,
    ["network", "observedAtUnix", "targetMasterchainBlock", "proofs"],
    "proof bundle",
    reasonCode,
  );
  if (value.network !== config.network) {
    throw new EnvelopeValidationError(
      reasonCode,
      "bundle network is not trusted",
    );
  }
  const observedAtUnix = requireInteger(
    value.observedAtUnix,
    0,
    Number.MAX_SAFE_INTEGER,
    "observedAtUnix",
    reasonCode,
  );
  if (observedAtUnix > nowUnix + config.maxFutureSkewSeconds) {
    throw new EnvelopeValidationError(
      "STALE_PROOF_BUNDLE",
      "bundle is from the future",
    );
  }
  if (nowUnix - observedAtUnix > config.maxProofAgeSeconds) {
    throw new EnvelopeValidationError("STALE_PROOF_BUNDLE", "bundle is stale");
  }
  const targetMasterchainBlock = validateBlockId(
    value.targetMasterchainBlock,
    "targetMasterchainBlock",
    reasonCode,
  );
  validateMasterchainBlock(
    targetMasterchainBlock,
    "targetMasterchainBlock",
    reasonCode,
  );
  if (targetMasterchainBlock.seqno <= config.trustedKeyBlock.seqno) {
    throw new EnvelopeValidationError(
      reasonCode,
      "target block does not advance the trusted key block",
    );
  }
  requireExactKeys(value.proofs, PROOF_KEYS, "proofs", reasonCode);
  const proofs = {} as TonRawProofs;
  const parsedProofs: Record<string, ParsedProof> = {};
  for (const key of PROOF_KEYS) {
    const raw = value.proofs[key];
    if (typeof raw !== "string") {
      throw new EnvelopeValidationError(reasonCode, `${key} must be a string`);
    }
    proofs[key] = raw;
    parsedProofs[key] = parseMerkleProof(raw, config.limits, key);
  }
  if (
    parsedProofs.masterchainBlockProofBocBase64.virtualRootHash !==
    targetMasterchainBlock.rootHash
  ) {
    throw new EnvelopeValidationError(
      reasonCode,
      "masterchain proof does not commit to the target root hash",
    );
  }
  try {
    const masterchainHeader = verifyTonMasterchainHeaderCell(
      parsedProofs.masterchainBlockProofBocBase64.virtualRoot,
      {
        globalId: config.globalId,
        targetBlock: targetMasterchainBlock,
        trustedKeyBlockSeqno: config.trustedKeyBlock.seqno,
      },
    );
    if (
      masterchainHeader.generatedAtUnix >
      observedAtUnix + config.maxFutureSkewSeconds
    ) {
      throw new EnvelopeValidationError(
        "STALE_PROOF_BUNDLE",
        "masterchain block generation time is from the future",
      );
    }
    if (
      nowUnix - masterchainHeader.generatedAtUnix >
      config.maxProofAgeSeconds
    ) {
      throw new EnvelopeValidationError(
        "STALE_PROOF_BUNDLE",
        "masterchain block is stale",
      );
    }
    parsedProofs.masterchainBlockProofBocBase64.masterchainHeader =
      masterchainHeader;
  } catch (error) {
    if (error instanceof EnvelopeValidationError) throw error;
    throw new EnvelopeValidationError(
      reasonCode,
      `masterchain header proof is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return {
    bundle: {
      network: config.network,
      observedAtUnix,
      targetMasterchainBlock,
      proofs,
    },
    parsedProofs,
  };
}

function structuralCommitment(
  config: TonTrustedNetworkConfig,
  bundle: TonProofBundle,
  parsedProofs: Record<string, ParsedProof>,
): string {
  const commitment = {
    domain: "telegram-garant/ton-proof-envelope/v1",
    policyVersion: config.policyVersion,
    network: config.network,
    globalId: config.globalId,
    zeroState: config.zeroState,
    trustedKeyBlock: config.trustedKeyBlock,
    targetMasterchainBlock: bundle.targetMasterchainBlock,
    observedAtUnix: bundle.observedAtUnix,
    proofs: PROOF_KEYS.map((key) => {
      const proof = parsedProofs[key];
      return {
        role: key,
        bocHash: proof.bocHash,
        rootHash: proof.rootHash,
        virtualRootHash: proof.virtualRootHash,
        cells: proof.cells,
        depth: proof.depth,
        masterchainHeader: proof.masterchainHeader ?? null,
      };
    }),
  };
  return createHash("sha256").update(JSON.stringify(commitment)).digest("hex");
}

export function validateTonProofEnvelope(
  trustedConfig: unknown,
  proofBundle: unknown,
  nowUnix: number,
): TonProofEnvelopeResult {
  if (!Number.isSafeInteger(nowUnix) || nowUnix < 0) {
    return fail("INVALID_PROOF_BUNDLE", "nowUnix is invalid");
  }
  try {
    const config = validateTrustedConfig(trustedConfig);
    const { bundle, parsedProofs } = validateBundle(
      proofBundle,
      config,
      nowUnix,
    );
    return {
      accepted: false,
      proofsVerified: false,
      authorizationAllowed: false,
      structuralChecksPassed: true,
      reasonCode: "CRYPTOGRAPHIC_VERIFICATION_REQUIRED",
      detail:
        "The envelope is well formed; cryptographic proof verification is not implemented.",
      structuralEvidenceHash: structuralCommitment(
        config,
        bundle,
        parsedProofs,
      ),
      verificationEvidenceHash: null,
      remainingChecks: REMAINING_CHECKS,
    };
  } catch (error) {
    if (error instanceof EnvelopeValidationError) {
      return fail(error.reasonCode, error.message);
    }
    return fail(
      "INVALID_PROOF_BUNDLE",
      "unexpected envelope validation failure",
    );
  }
}
