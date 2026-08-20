import { Cell, CellType, loadShardIdent, Slice } from "@ton/core";
import type {
  TonProofBlockId,
  TonProofResourceLimits,
} from "./ton-proof-envelope";
import { parseTonMerkleProofBoc } from "./ton-proof-envelope";
import type { TonLiteBlockLinkForward } from "./ton-lite-signature-proof";
import { verifyTonForwardLinkSignatures } from "./ton-lite-signature-proof";
import {
  computeTonValidatorSetHash,
  deriveTonMasterchainValidatorSet,
  parseTonCatchainConfigCell,
  parseTonValidatorSetCell,
} from "./ton-validator-set";

const BLOCK_TAG = 0x11ef55aa;
const BLOCK_INFO_TAG = 0x9bc7a987;
const MASTERCHAIN_EXTRA_TAG = 0xcca5;
const MASTERCHAIN_SHARD = "-9223372036854775808";

export type TonAuthenticatedDictionaryLookup =
  | { status: "present"; value: Cell }
  | { status: "absent" }
  | { status: "unproven" };

export interface TonForwardLinkProofExpectation {
  globalId: number;
  trustedSourceKeyBlock: TonProofBlockId;
  limits: TonProofResourceLimits;
}

export interface TonVerifiedForwardKeyBlockLink {
  kind: "TON_VERIFIED_FORWARD_KEY_BLOCK_LINK";
  configProofVerified: true;
  destinationProofVerified: true;
  sourceConfigProven: true;
  validatorSetProven: true;
  headerBindingVerified: true;
  signaturesVerified: true;
  thresholdVerified: true;
  consensus: "ordinary" | "simplex";
  linkVerified: true;
  finalityProven: false;
  sourceBlock: TonProofBlockId;
  destinationBlock: TonProofBlockId;
  destinationIsKeyBlock: boolean;
  destinationGeneratedAtUnix: number;
  catchainSeqno: number;
  validatorSetHash: number;
  validatorCount: number;
  signedWeight: string;
  totalWeight: string;
  signerCount: number;
  signedDataHash: string;
  configAddress: string;
  configRootHash: string;
  validatorParameter: 34 | 35;
  catchainParameter: "present" | "proven-absent-default";
  configProofRootHash: string;
  destinationProofRootHash: string;
}

export class TonForwardLinkProofError extends Error {
  readonly name = "TonForwardLinkProofError";
}

function reject(message: string): never {
  throw new TonForwardLinkProofError(message);
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

function requireMasterchainBlock(block: TonProofBlockId, label: string): void {
  if (block.workchain !== -1 || block.shard !== MASTERCHAIN_SHARD) {
    reject(`${label} is not a masterchain block`);
  }
}

function parseLabel(source: Slice, remaining: number): string {
  const first = source.loadBit();
  let length: number;
  let repeated: boolean | null = null;
  if (!first) {
    length = 0;
    while (source.loadBit()) {
      length += 1;
      if (length > remaining) reject("dictionary short label is too long");
    }
  } else if (!source.loadBit()) {
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("dictionary long label is too long");
  } else {
    repeated = source.loadBit();
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("dictionary same label is too long");
  }
  let label = "";
  for (let index = 0; index < length; index += 1) {
    label += (repeated ?? source.loadBit()) ? "1" : "0";
  }
  return label;
}

function validateDictionaryNodeShape(
  source: Slice,
  remainingAfterLabel: number,
): { left: Cell; right: Cell } | { value: Cell } {
  if (remainingAfterLabel === 0) {
    const value = source.loadRef();
    source.endParse();
    return { value };
  }
  const left = source.loadRef();
  const right = source.loadRef();
  source.endParse();
  return { left, right };
}

export function lookupTonHashmapRef(
  root: Cell,
  key: string,
): TonAuthenticatedDictionaryLookup {
  if (!/^[01]+$/.test(key) || key.length > 1023) {
    reject("dictionary key bits are invalid");
  }
  let node = root;
  let offset = 0;
  let remaining = key.length;
  for (;;) {
    if (node.type === CellType.PrunedBranch) return { status: "unproven" };
    if (node.type !== CellType.Ordinary) {
      reject("authenticated dictionary path contains a non-ordinary cell");
    }
    try {
      const source = node.beginParse();
      const label = parseLabel(source, remaining);
      const afterLabel = remaining - label.length;
      const shape = validateDictionaryNodeShape(source, afterLabel);
      if (label !== key.slice(offset, offset + label.length)) {
        return { status: "absent" };
      }
      offset += label.length;
      if (afterLabel === 0) {
        return { status: "present", value: (shape as { value: Cell }).value };
      }
      const branch = key[offset];
      offset += 1;
      remaining = afterLabel - 1;
      node =
        branch === "0"
          ? (shape as { left: Cell; right: Cell }).left
          : (shape as { left: Cell; right: Cell }).right;
    } catch (error) {
      if (error instanceof TonForwardLinkProofError) throw error;
      reject(
        `authenticated dictionary is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}

export function lookupTonConfigParameter(
  root: Cell,
  parameter: number,
): TonAuthenticatedDictionaryLookup {
  if (
    !Number.isSafeInteger(parameter) ||
    parameter < 0 ||
    parameter > 0x7fffffff
  ) {
    reject("configuration parameter is outside int32");
  }
  return lookupTonHashmapRef(root, parameter.toString(2).padStart(32, "0"));
}

interface ParsedForwardHeader {
  keyBlock: boolean;
  generatedAtUnix: number;
  catchainSeqno: number;
  validatorSetHash: number;
  extra: Cell;
}

function signedShardString(shard: bigint): string {
  return (shard >= 1n << 63n ? shard - (1n << 64n) : shard).toString();
}

function parseForwardHeader(
  root: Cell,
  expected: TonProofBlockId,
  globalId: number,
  label: string,
): ParsedForwardHeader {
  if (root.type !== CellType.Ordinary)
    reject(`${label} block root is not ordinary`);
  if (root.hash(0).toString("hex") !== expected.rootHash) {
    reject(`${label} block root hash does not match its BlockIdExt`);
  }
  try {
    const block = root.beginParse();
    if (block.loadUint(32) !== BLOCK_TAG) reject(`${label} is not a TON Block`);
    if (block.loadInt(32) !== globalId)
      reject(`${label} global_id is not trusted`);
    const infoCell = block.loadRef();
    block.loadRef();
    block.loadRef();
    const extra = block.loadRef();
    block.endParse();
    if (infoCell.type !== CellType.Ordinary)
      reject(`${label} BlockInfo is absent`);
    const info = infoCell.beginParse();
    if (info.loadUint(32) !== BLOCK_INFO_TAG)
      reject(`${label} BlockInfo tag is invalid`);
    if (info.loadUint(32) !== 0)
      reject(`${label} BlockInfo version is unsupported`);
    const notMaster = info.loadBit();
    const afterMerge = info.loadBit();
    const beforeSplit = info.loadBit();
    const afterSplit = info.loadBit();
    const wantSplit = info.loadBit();
    const wantMerge = info.loadBit();
    const keyBlock = info.loadBit();
    const verticalSeqnoIncrement = info.loadBit();
    const flags = info.loadUint(8);
    if (flags > 1) reject(`${label} BlockInfo flags are unsupported`);
    const seqno = info.loadUint(32);
    const verticalSeqno = info.loadUint(32);
    const shard = loadShardIdent(info);
    const generatedAtUnix = info.loadUint(32);
    const startLt = info.loadUintBig(64);
    const endLt = info.loadUintBig(64);
    const validatorSetHash = info.loadUint(32);
    const catchainSeqno = info.loadUint(32);
    const minReferencedSeqno = info.loadUint(32);
    const previousKeyBlockSeqno = info.loadUint(32);
    if ((flags & 1) !== 0) {
      if (info.loadUint(8) !== 0xc4)
        reject(`${label} GlobalVersion tag is invalid`);
      info.loadUint(32);
      info.loadUintBig(64);
    }
    info.loadRef();
    if (verticalSeqnoIncrement) info.loadRef();
    info.endParse();
    if (
      notMaster ||
      afterMerge ||
      beforeSplit ||
      afterSplit ||
      wantSplit ||
      wantMerge
    ) {
      reject(`${label} is not a canonical masterchain header`);
    }
    if (
      shard.workchainId !== -1 ||
      shard.shardPrefixBits !== 0 ||
      signedShardString(shard.shardPrefix) !== MASTERCHAIN_SHARD
    ) {
      reject(`${label} BlockInfo shard is not the masterchain`);
    }
    if (seqno !== expected.seqno)
      reject(`${label} BlockInfo seqno is incorrect`);
    if (verticalSeqno < Number(verticalSeqnoIncrement)) {
      reject(`${label} vertical sequence is invalid`);
    }
    if (startLt >= endLt) reject(`${label} logical-time interval is invalid`);
    if (minReferencedSeqno > seqno || previousKeyBlockSeqno > seqno) {
      reject(`${label} masterchain sequence metadata is invalid`);
    }
    return {
      keyBlock,
      generatedAtUnix,
      catchainSeqno,
      validatorSetHash,
      extra,
    };
  } catch (error) {
    if (error instanceof TonForwardLinkProofError) throw error;
    reject(
      `${label} block header is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function extractKeyBlockConfig(extraCell: Cell): {
  configAddress: string;
  configRoot: Cell;
} {
  if (extraCell.type !== CellType.Ordinary)
    reject("source BlockExtra is absent");
  try {
    const extra = extraCell.beginParse();
    extra.loadRef();
    extra.loadRef();
    extra.loadRef();
    extra.loadBuffer(32);
    extra.loadBuffer(32);
    if (!extra.loadBit()) reject("source block has no masterchain extra");
    const masterchainExtra = extra.loadRef();
    extra.endParse();
    if (masterchainExtra.type !== CellType.Ordinary) {
      reject("source masterchain extra is absent");
    }
    const source = masterchainExtra.beginParse();
    if (source.loadUint(16) !== MASTERCHAIN_EXTRA_TAG) {
      reject("source masterchain extra tag is invalid");
    }
    if (!source.loadBit()) reject("source block is not a key block");
    source.loadMaybeRef(); // ShardHashes
    source.loadMaybeRef(); // ShardFees
    source.loadRef(); // signatures/messages bracket remains hash-committed
    const configAddress = source.loadBuffer(32).toString("hex");
    const configRoot = source.loadRef();
    source.endParse();
    if (configRoot.type !== CellType.Ordinary) {
      reject("configuration dictionary root is not proven");
    }
    return { configAddress, configRoot };
  } catch (error) {
    if (error instanceof TonForwardLinkProofError) throw error;
    reject(
      `source key-block configuration is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function requirePresent(
  lookup: TonAuthenticatedDictionaryLookup,
  parameter: number,
): Cell {
  if (lookup.status === "present") return lookup.value;
  if (lookup.status === "unproven") {
    reject(`configuration parameter ${parameter} is hidden by a pruned branch`);
  }
  reject(`configuration parameter ${parameter} is proven absent`);
}

export function verifyTonForwardKeyBlockLink(
  link: TonLiteBlockLinkForward,
  expectation: TonForwardLinkProofExpectation,
): TonVerifiedForwardKeyBlockLink {
  requireMasterchainBlock(link.from, "forward link source");
  requireMasterchainBlock(link.to, "forward link destination");
  if (!blockIdsEqual(link.from, expectation.trustedSourceKeyBlock)) {
    reject("forward link source does not match the trusted key block");
  }
  if (link.to.seqno <= link.from.seqno) reject("forward link does not advance");

  const configProof = parseTonMerkleProofBoc(
    link.configProof,
    expectation.limits,
    "config_proof",
  );
  const destinationProof = parseTonMerkleProofBoc(
    link.destProof,
    expectation.limits,
    "dest_proof",
  );
  if (configProof.virtualRootHash !== link.from.rootHash) {
    reject("config_proof does not authenticate the source block");
  }
  if (destinationProof.virtualRootHash !== link.to.rootHash) {
    reject("dest_proof does not authenticate the destination block");
  }

  const sourceHeader = parseForwardHeader(
    configProof.virtualRoot,
    link.from,
    expectation.globalId,
    "source",
  );
  if (!sourceHeader.keyBlock) reject("forward link source is not a key block");
  const destinationHeader = parseForwardHeader(
    destinationProof.virtualRoot,
    link.to,
    expectation.globalId,
    "destination",
  );
  if (destinationHeader.keyBlock !== link.toKeyBlock) {
    reject("toKeyBlock does not match the destination header");
  }

  const { configAddress, configRoot } = extractKeyBlockConfig(
    sourceHeader.extra,
  );
  const catchainLookup = lookupTonConfigParameter(configRoot, 28);
  if (catchainLookup.status === "unproven") {
    reject("configuration parameter 28 is hidden by a pruned branch");
  }
  const catchainConfig = parseTonCatchainConfigCell(
    catchainLookup.status === "present" ? catchainLookup.value : null,
  );
  const temporaryValidators = lookupTonConfigParameter(configRoot, 35);
  let validatorParameter: 34 | 35;
  let validatorCell: Cell;
  if (temporaryValidators.status === "present") {
    validatorParameter = 35;
    validatorCell = temporaryValidators.value;
  } else {
    if (temporaryValidators.status === "unproven") {
      reject("configuration parameter 35 is hidden by a pruned branch");
    }
    validatorParameter = 34;
    validatorCell = requirePresent(
      lookupTonConfigParameter(configRoot, 34),
      34,
    );
  }
  const parsedValidators = parseTonValidatorSetCell(validatorCell);
  const derived = deriveTonMasterchainValidatorSet(
    parsedValidators,
    catchainConfig,
    destinationHeader.catchainSeqno,
  );
  const reproducedHash = computeTonValidatorSetHash(
    destinationHeader.catchainSeqno,
    derived.validators,
  );
  if (
    reproducedHash !== destinationHeader.validatorSetHash ||
    derived.validatorSetHash !== destinationHeader.validatorSetHash
  ) {
    reject(
      "destination validator-list hash does not match proven configuration",
    );
  }
  const signatures = verifyTonForwardLinkSignatures(
    link,
    derived.signatureValidatorSet,
  );

  return {
    kind: "TON_VERIFIED_FORWARD_KEY_BLOCK_LINK",
    configProofVerified: true,
    destinationProofVerified: true,
    sourceConfigProven: true,
    validatorSetProven: true,
    headerBindingVerified: true,
    signaturesVerified: true,
    thresholdVerified: true,
    consensus: signatures.consensus,
    linkVerified: true,
    finalityProven: false,
    sourceBlock: { ...link.from },
    destinationBlock: { ...link.to },
    destinationIsKeyBlock: destinationHeader.keyBlock,
    destinationGeneratedAtUnix: destinationHeader.generatedAtUnix,
    catchainSeqno: derived.catchainSeqno,
    validatorSetHash: derived.validatorSetHash,
    validatorCount: derived.validators.length,
    signedWeight: signatures.signedWeight,
    totalWeight: signatures.totalWeight,
    signerCount: signatures.signerCount,
    signedDataHash: signatures.signedDataHash,
    configAddress,
    configRootHash: configRoot.hash(0).toString("hex"),
    validatorParameter,
    catchainParameter:
      catchainLookup.status === "present" ? "present" : "proven-absent-default",
    configProofRootHash: configProof.rootHash,
    destinationProofRootHash: destinationProof.rootHash,
  };
}
