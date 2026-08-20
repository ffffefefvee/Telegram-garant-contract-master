import { createHash } from "crypto";
import { signVerify } from "@ton/crypto";
import type { TonProofBlockId } from "./ton-proof-envelope";

const PARTIAL_BLOCK_PROOF_ID = 0x8ed0d2c1;
const BLOCK_LINK_BACK_ID = 0xef7e1bef;
const BLOCK_LINK_FORWARD_ID = 0x520fce1c;
const SIGNATURE_SET_ORDINARY_ID = 0xf644a6e6;
const SIGNATURE_SET_SIMPLEX_ID = 0xac249800;
const SIGNATURE_ID = 0xa3def855;
const VECTOR_ID = 0x1cb5c415;
const BOOL_TRUE_ID = 0x997275b5;
const BOOL_FALSE_ID = 0xbc799737;
const TON_BLOCK_ID_ID = 0xc50b6e70;
const ED25519_PUBLIC_KEY_ID = 0x4813b4c6;
const CONSENSUS_DATA_TO_SIGN_ID = 0xa8e33df8;
const CONSENSUS_CANDIDATE_ID = 0xb691cd3f;
const CONSENSUS_CANDIDATE_PARENT_ID = 0x1a4b9af1;
const CONSENSUS_WITHOUT_PARENTS_ID = 0x22cbcca9;
const CONSENSUS_CANDIDATE_ORDINARY_ID = 0xe8f9bcdc;
const CONSENSUS_CANDIDATE_EMPTY_ID = 0x72b4d933;
const CONSENSUS_FINALIZE_VOTE_ID = 0x40a7e105;
const MASTERCHAIN_SHARD = "-9223372036854775808";
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/;
const MAX_VALIDATOR_WEIGHT = 1n << 61n;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface TonLiteProofLimits {
  maxBytes: number;
  maxLinks: number;
  maxSignaturesPerLink: number;
  maxEmbeddedProofBytes: number;
}

export interface TonLiteSignature {
  nodeIdShort: string;
  signature: Buffer;
}

export interface TonLiteOrdinarySignatureSet {
  kind: "ordinary";
  validatorSetHash: number;
  catchainSeqno: number;
  signatures: readonly TonLiteSignature[];
}

export interface TonLiteSimplexSignatureSet {
  kind: "simplex";
  validatorSetHash: number;
  catchainSeqno: number;
  signatures: readonly TonLiteSignature[];
  sessionId: Buffer;
  slot: number;
  candidate: Buffer;
}

export type TonLiteSignatureSet =
  | TonLiteOrdinarySignatureSet
  | TonLiteSimplexSignatureSet;

export interface TonLiteBlockLinkBack {
  kind: "back";
  toKeyBlock: boolean;
  from: TonProofBlockId;
  to: TonProofBlockId;
  destProof: Buffer;
  proof: Buffer;
  stateProof: Buffer;
}

export interface TonLiteBlockLinkForward {
  kind: "forward";
  toKeyBlock: boolean;
  from: TonProofBlockId;
  to: TonProofBlockId;
  destProof: Buffer;
  configProof: Buffer;
  signatures: TonLiteSignatureSet;
}

export type TonLiteBlockLink = TonLiteBlockLinkBack | TonLiteBlockLinkForward;

export interface TonLitePartialBlockProof {
  complete: boolean;
  from: TonProofBlockId;
  to: TonProofBlockId;
  steps: readonly TonLiteBlockLink[];
  rawHash: string;
}

export interface TonValidatorDescriptor {
  publicKey: string;
  weight: string;
}

export interface TonUnprovenValidatorSet {
  validatorSetHash: number;
  catchainSeqno: number;
  validators: readonly TonValidatorDescriptor[];
}

export interface TonOrdinarySignatureVerification {
  kind: "TON_ORDINARY_SIGNATURES_VERIFIED";
  signaturesVerified: true;
  thresholdVerified: true;
  validatorSetProven: false;
  finalityProven: false;
  block: TonProofBlockId;
  validatorSetHash: number;
  catchainSeqno: number;
  signedWeight: string;
  totalWeight: string;
  signerCount: number;
  signedDataHash: string;
}

export interface TonForwardLinkSignatureVerification {
  kind: "TON_FORWARD_LINK_SIGNATURES_VERIFIED";
  consensus: "ordinary" | "simplex";
  signaturesVerified: true;
  thresholdVerified: true;
  validatorSetProven: false;
  finalityProven: false;
  block: TonProofBlockId;
  validatorSetHash: number;
  catchainSeqno: number;
  signedWeight: string;
  totalWeight: string;
  signerCount: number;
  signedDataHash: string;
}

export class TonLiteSignatureProofError extends Error {
  readonly name = "TonLiteSignatureProofError";
}

function reject(message: string): never {
  throw new TonLiteSignatureProofError(message);
}

function uint32Buffer(value: number): Buffer {
  const result = Buffer.allocUnsafe(4);
  result.writeUInt32LE(value >>> 0);
  return result;
}

function tlBytesBuffer(value: Buffer): Buffer {
  if (value.length > 0xffffff) reject("TL bytes value is too large");
  const prefix =
    value.length < 254
      ? Buffer.from([value.length])
      : Buffer.from([
          254,
          value.length & 0xff,
          (value.length >> 8) & 0xff,
          (value.length >> 16) & 0xff,
        ]);
  const padding = Buffer.alloc((4 - ((prefix.length + value.length) % 4)) % 4);
  return Buffer.concat([prefix, value, padding]);
}

function signedShardString(value: bigint): string {
  return (value >= 1n << 63n ? value - (1n << 64n) : value).toString();
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

function validateLimits(limits: TonLiteProofLimits): void {
  const values: Array<[number, number, number, string]> = [
    [limits.maxBytes, 1, 16 * 1024 * 1024, "maxBytes"],
    [limits.maxLinks, 1, 4096, "maxLinks"],
    [limits.maxSignaturesPerLink, 1, 4096, "maxSignaturesPerLink"],
    [
      limits.maxEmbeddedProofBytes,
      1,
      16 * 1024 * 1024,
      "maxEmbeddedProofBytes",
    ],
  ];
  for (const [value, minimum, maximum, label] of values) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      reject(`${label} is out of range`);
    }
  }
}

function decodeCanonicalBase64(value: unknown, maxBytes: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !CANONICAL_BASE64.test(value)
  ) {
    reject("partial proof is not canonical base64");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedSize = (value.length / 4) * 3 - padding;
  if (decodedSize > maxBytes) reject("partial proof exceeds maxBytes");
  const result = Buffer.from(value, "base64");
  if (result.toString("base64") !== value) {
    reject("partial proof is not canonical base64");
  }
  return result;
}

class TlReader {
  private offset = 0;

  constructor(private readonly source: Buffer) {}

  remaining(): number {
    return this.source.length - this.offset;
  }

  end(): void {
    if (this.remaining() !== 0) reject("TL payload contains trailing bytes");
  }

  uint32(label: string): number {
    if (this.remaining() < 4) reject(`${label} is truncated`);
    const value = this.source.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  int32(label: string): number {
    if (this.remaining() < 4) reject(`${label} is truncated`);
    const value = this.source.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  uint64(label: string): bigint {
    if (this.remaining() < 8) reject(`${label} is truncated`);
    const value = this.source.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  fixed(length: number, label: string): Buffer {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.remaining() < length
    ) {
      reject(`${label} is truncated`);
    }
    const result = this.source.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  bytes(maxBytes: number, label: string): Buffer {
    if (this.remaining() < 1) reject(`${label} is truncated`);
    const first = this.source[this.offset];
    this.offset += 1;
    let length: number;
    let prefixLength = 1;
    if (first < 254) {
      length = first;
    } else if (first === 254) {
      if (this.remaining() < 3) reject(`${label} length is truncated`);
      length =
        this.source[this.offset] |
        (this.source[this.offset + 1] << 8) |
        (this.source[this.offset + 2] << 16);
      this.offset += 3;
      prefixLength = 4;
      if (length < 254) reject(`${label} uses a non-canonical length`);
    } else {
      reject(`${label} has an invalid length prefix`);
    }
    if (length > maxBytes) reject(`${label} exceeds its byte limit`);
    const value = this.fixed(length, label);
    const padding = (4 - ((prefixLength + length) % 4)) % 4;
    const paddingBytes = this.fixed(padding, `${label} padding`);
    if (paddingBytes.some((byte) => byte !== 0)) {
      reject(`${label} has non-zero padding`);
    }
    return value;
  }

  bool(label: string): boolean {
    const id = this.uint32(`${label} constructor`);
    if (id === BOOL_TRUE_ID) return true;
    if (id === BOOL_FALSE_ID) return false;
    reject(`${label} has an invalid Bool constructor`);
  }

  vectorLength(limit: number, label: string): number {
    if (this.uint32(`${label} constructor`) !== VECTOR_ID) {
      reject(`${label} has an invalid vector constructor`);
    }
    const count = this.uint32(`${label} count`);
    if (count > limit) reject(`${label} exceeds its item limit`);
    return count;
  }
}

function decodeBlockId(reader: TlReader, label: string): TonProofBlockId {
  const workchain = reader.int32(`${label}.workchain`);
  const shard = signedShardString(reader.uint64(`${label}.shard`));
  const seqno = reader.uint32(`${label}.seqno`);
  const rootHash = reader.fixed(32, `${label}.rootHash`).toString("hex");
  const fileHash = reader.fixed(32, `${label}.fileHash`).toString("hex");
  if (!HASH_PATTERN.test(rootHash) || rootHash === "0".repeat(64)) {
    reject(`${label}.rootHash is invalid`);
  }
  if (!HASH_PATTERN.test(fileHash) || fileHash === "0".repeat(64)) {
    reject(`${label}.fileHash is invalid`);
  }
  return { workchain, shard, seqno, rootHash, fileHash };
}

function decodeSignatures(
  reader: TlReader,
  limit: number,
): readonly TonLiteSignature[] {
  const count = reader.vectorLength(limit, "signatures");
  const signatures: TonLiteSignature[] = [];
  for (let index = 0; index < count; index += 1) {
    if (reader.uint32(`signature[${index}] constructor`) !== SIGNATURE_ID) {
      reject(`signature[${index}] has an invalid constructor`);
    }
    const nodeIdShort = reader
      .fixed(32, `signature[${index}].nodeIdShort`)
      .toString("hex");
    const signature = reader.bytes(64, `signature[${index}].signature`);
    if (signature.length !== 64) {
      reject(`signature[${index}] must contain 64 bytes`);
    }
    signatures.push({ nodeIdShort, signature });
  }
  return signatures;
}

function decodeSignatureSet(
  reader: TlReader,
  limits: TonLiteProofLimits,
): TonLiteSignatureSet {
  const constructor = reader.uint32("signature set constructor");
  if (constructor === SIGNATURE_SET_ORDINARY_ID) {
    return {
      kind: "ordinary",
      validatorSetHash: reader.uint32("validatorSetHash"),
      catchainSeqno: reader.uint32("catchainSeqno"),
      signatures: decodeSignatures(reader, limits.maxSignaturesPerLink),
    };
  }
  if (constructor === SIGNATURE_SET_SIMPLEX_ID) {
    const catchainSeqno = reader.uint32("catchainSeqno");
    const validatorSetHash = reader.uint32("validatorSetHash");
    const signatures = decodeSignatures(
      reader,
      limits.maxSignaturesPerLink,
    );
    return {
      kind: "simplex",
      validatorSetHash,
      catchainSeqno,
      signatures,
      sessionId: reader.fixed(32, "sessionId"),
      slot: reader.uint32("slot"),
      candidate: reader.bytes(
        limits.maxEmbeddedProofBytes,
        "simplex candidate",
      ),
    };
  }
  reject("unsupported signature set constructor");
}

function decodeLink(
  reader: TlReader,
  limits: TonLiteProofLimits,
  index: number,
): TonLiteBlockLink {
  const constructor = reader.uint32(`steps[${index}] constructor`);
  if (
    constructor !== BLOCK_LINK_BACK_ID &&
    constructor !== BLOCK_LINK_FORWARD_ID
  ) {
    reject(`steps[${index}] has an unknown BlockLink constructor`);
  }
  const toKeyBlock = reader.bool(`steps[${index}].toKeyBlock`);
  const from = decodeBlockId(reader, `steps[${index}].from`);
  const to = decodeBlockId(reader, `steps[${index}].to`);
  const destProof = reader.bytes(
    limits.maxEmbeddedProofBytes,
    `steps[${index}].destProof`,
  );
  if (constructor === BLOCK_LINK_BACK_ID) {
    return {
      kind: "back",
      toKeyBlock,
      from,
      to,
      destProof,
      proof: reader.bytes(
        limits.maxEmbeddedProofBytes,
        `steps[${index}].proof`,
      ),
      stateProof: reader.bytes(
        limits.maxEmbeddedProofBytes,
        `steps[${index}].stateProof`,
      ),
    };
  }
  if (constructor === BLOCK_LINK_FORWARD_ID) {
    return {
      kind: "forward",
      toKeyBlock,
      from,
      to,
      destProof,
      configProof: reader.bytes(
        limits.maxEmbeddedProofBytes,
        `steps[${index}].configProof`,
      ),
      signatures: decodeSignatureSet(reader, limits),
    };
  }
  reject(`steps[${index}] has an unreachable BlockLink constructor`);
}

function validateChain(proof: TonLitePartialBlockProof): void {
  if (proof.from.workchain !== -1 || proof.from.shard !== MASTERCHAIN_SHARD) {
    reject("partial proof origin is not a masterchain block");
  }
  if (proof.to.workchain !== -1 || proof.to.shard !== MASTERCHAIN_SHARD) {
    reject("partial proof destination is not a masterchain block");
  }
  if (proof.steps.length === 0) {
    if (!blockIdsEqual(proof.from, proof.to)) {
      reject("empty partial proof does not have identical endpoints");
    }
    return;
  }
  let cursor = proof.from;
  for (let index = 0; index < proof.steps.length; index += 1) {
    const step = proof.steps[index];
    if (!blockIdsEqual(step.from, cursor)) {
      reject(`steps[${index}] is not contiguous with the previous endpoint`);
    }
    if (step.kind === "forward" && step.to.seqno <= step.from.seqno) {
      reject(`steps[${index}] forward link does not advance the sequence`);
    }
    if (step.kind === "back" && step.to.seqno >= step.from.seqno) {
      reject(`steps[${index}] back link does not decrease the sequence`);
    }
    cursor = step.to;
  }
  if (!blockIdsEqual(cursor, proof.to)) {
    reject("partial proof steps do not terminate at the declared destination");
  }
}

export function decodeTonLitePartialBlockProof(
  rawBase64: unknown,
  limits: TonLiteProofLimits,
): TonLitePartialBlockProof {
  validateLimits(limits);
  const raw = decodeCanonicalBase64(rawBase64, limits.maxBytes);
  const reader = new TlReader(raw);
  if (reader.uint32("partial proof constructor") !== PARTIAL_BLOCK_PROOF_ID) {
    reject("invalid PartialBlockProof constructor");
  }
  const complete = reader.bool("complete");
  const from = decodeBlockId(reader, "from");
  const to = decodeBlockId(reader, "to");
  const count = reader.vectorLength(limits.maxLinks, "steps");
  const steps: TonLiteBlockLink[] = [];
  for (let index = 0; index < count; index += 1) {
    steps.push(decodeLink(reader, limits, index));
  }
  reader.end();
  const result: TonLitePartialBlockProof = {
    complete,
    from,
    to,
    steps,
    rawHash: createHash("sha256").update(raw).digest("hex"),
  };
  validateChain(result);
  return result;
}

export function tonNodeIdShort(publicKey: Buffer): Buffer {
  if (publicKey.length !== 32) reject("validator public key must be 32 bytes");
  return createHash("sha256")
    .update(uint32Buffer(ED25519_PUBLIC_KEY_ID))
    .update(publicKey)
    .digest();
}

export function tonOrdinaryBlockSignedData(block: TonProofBlockId): Buffer {
  if (
    block.workchain !== -1 ||
    block.shard !== MASTERCHAIN_SHARD ||
    !Number.isSafeInteger(block.seqno) ||
    block.seqno < 0 ||
    block.seqno > 0xffffffff ||
    !HASH_PATTERN.test(block.rootHash) ||
    !HASH_PATTERN.test(block.fileHash)
  ) {
    reject("signed block ID is invalid");
  }
  return Buffer.concat([
    uint32Buffer(TON_BLOCK_ID_ID),
    Buffer.from(block.rootHash, "hex"),
    Buffer.from(block.fileHash, "hex"),
  ]);
}

function decodeSimplexCandidateBlock(
  candidate: Buffer,
): TonProofBlockId {
  const reader = new TlReader(candidate);
  const constructor = reader.uint32("simplex candidate constructor");
  if (
    constructor !== CONSENSUS_CANDIDATE_ORDINARY_ID &&
    constructor !== CONSENSUS_CANDIDATE_EMPTY_ID
  ) {
    reject("simplex candidate has an unsupported constructor");
  }
  const block = decodeBlockId(reader, "simplex candidate block");
  if (constructor === CONSENSUS_CANDIDATE_ORDINARY_ID) {
    reader.fixed(32, "simplex candidate collated file hash");
    const parentConstructor = reader.uint32(
      "simplex candidate parent constructor",
    );
    if (parentConstructor === CONSENSUS_CANDIDATE_PARENT_ID) {
      if (
        reader.uint32("simplex parent candidate constructor") !==
        CONSENSUS_CANDIDATE_ID
      ) {
        reject("simplex parent candidate has an invalid constructor");
      }
      reader.uint32("simplex parent candidate slot");
      reader.fixed(32, "simplex parent candidate hash");
    } else if (parentConstructor !== CONSENSUS_WITHOUT_PARENTS_ID) {
      reject("simplex candidate parent has an unsupported constructor");
    }
  } else {
    reader.uint32("simplex empty parent slot");
    reader.fixed(32, "simplex empty parent hash");
  }
  reader.end();
  return block;
}

export function tonSimplexBlockSignedData(
  link: TonLiteBlockLinkForward,
): Buffer {
  if (link.signatures.kind !== "simplex") {
    reject("forward link does not contain Simplex signatures");
  }
  const candidateBlock = decodeSimplexCandidateBlock(
    link.signatures.candidate,
  );
  if (!blockIdsEqual(candidateBlock, link.to)) {
    reject("simplex candidate block does not match the forward-link target");
  }
  const candidateHash = createHash("sha256")
    .update(link.signatures.candidate)
    .digest();
  const candidateId = Buffer.concat([
    uint32Buffer(CONSENSUS_CANDIDATE_ID),
    uint32Buffer(link.signatures.slot),
    candidateHash,
  ]);
  const finalizeVote = Buffer.concat([
    uint32Buffer(CONSENSUS_FINALIZE_VOTE_ID),
    candidateId,
  ]);
  return Buffer.concat([
    uint32Buffer(CONSENSUS_DATA_TO_SIGN_ID),
    link.signatures.sessionId,
    tlBytesBuffer(finalizeVote),
  ]);
}

function parseWeight(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    reject(`${label} is not a canonical weight`);
  }
  const weight = BigInt(value);
  if (weight <= 0n || weight > MAX_VALIDATOR_WEIGHT) {
    reject(`${label} is out of range`);
  }
  return weight;
}

export function verifyTonForwardLinkSignatures(
  link: TonLiteBlockLinkForward,
  validatorSet: TonUnprovenValidatorSet,
): TonForwardLinkSignatureVerification {
  if (
    !Number.isSafeInteger(validatorSet.validatorSetHash) ||
    validatorSet.validatorSetHash < 0 ||
    validatorSet.validatorSetHash > 0xffffffff ||
    !Number.isSafeInteger(validatorSet.catchainSeqno) ||
    validatorSet.catchainSeqno < 0 ||
    validatorSet.catchainSeqno > 0xffffffff
  ) {
    reject("validator set metadata is invalid");
  }
  if (link.signatures.validatorSetHash !== validatorSet.validatorSetHash) {
    reject("validator set hash mismatch");
  }
  if (link.signatures.catchainSeqno !== validatorSet.catchainSeqno) {
    reject("catchain sequence mismatch");
  }
  if (validatorSet.validators.length === 0) reject("validator set is empty");

  const validators = new Map<string, { publicKey: Buffer; weight: bigint }>();
  let totalWeight = 0n;
  for (let index = 0; index < validatorSet.validators.length; index += 1) {
    const descriptor = validatorSet.validators[index];
    if (!PUBLIC_KEY_PATTERN.test(descriptor.publicKey)) {
      reject(`validators[${index}].publicKey is invalid`);
    }
    const publicKey = Buffer.from(descriptor.publicKey, "hex");
    const nodeId = tonNodeIdShort(publicKey).toString("hex");
    if (validators.has(nodeId))
      reject("validator set contains duplicate nodes");
    const weight = parseWeight(
      descriptor.weight,
      `validators[${index}].weight`,
    );
    totalWeight += weight;
    if (totalWeight > MAX_VALIDATOR_WEIGHT) {
      reject("validator total weight exceeds the protocol cap");
    }
    validators.set(nodeId, { publicKey, weight });
  }

  const signedData =
    link.signatures.kind === "ordinary"
      ? tonOrdinaryBlockSignedData(link.to)
      : tonSimplexBlockSignedData(link);
  const seen = new Set<string>();
  let signedWeight = 0n;
  for (const signature of link.signatures.signatures) {
    if (seen.has(signature.nodeIdShort)) reject("duplicate signer");
    seen.add(signature.nodeIdShort);
    const validator = validators.get(signature.nodeIdShort);
    if (!validator) reject("signature belongs to an unknown validator");
    if (!signVerify(signedData, signature.signature, validator.publicKey)) {
      reject("invalid validator signature");
    }
    signedWeight += validator.weight;
  }
  if (signedWeight * 3n <= totalWeight * 2n) {
    reject("validator signature weight does not exceed two thirds");
  }

  return {
    kind: "TON_FORWARD_LINK_SIGNATURES_VERIFIED",
    consensus: link.signatures.kind,
    signaturesVerified: true,
    thresholdVerified: true,
    validatorSetProven: false,
    finalityProven: false,
    block: { ...link.to },
    validatorSetHash: validatorSet.validatorSetHash,
    catchainSeqno: validatorSet.catchainSeqno,
    signedWeight: signedWeight.toString(),
    totalWeight: totalWeight.toString(),
    signerCount: seen.size,
    signedDataHash: createHash("sha256").update(signedData).digest("hex"),
  };
}

export function verifyTonOrdinaryForwardLinkSignatures(
  link: TonLiteBlockLinkForward,
  validatorSet: TonUnprovenValidatorSet,
): TonOrdinarySignatureVerification {
  if (link.signatures.kind !== "ordinary") {
    reject("forward link does not contain ordinary signatures");
  }
  const verified = verifyTonForwardLinkSignatures(link, validatorSet);
  return {
    ...verified,
    kind: "TON_ORDINARY_SIGNATURES_VERIFIED",
  };
}
