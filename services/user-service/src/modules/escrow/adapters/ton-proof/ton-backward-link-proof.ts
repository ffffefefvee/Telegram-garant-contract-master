import {
  Cell,
  CellType,
  exoticMerkleUpdate,
  loadShardIdent,
  Slice,
} from "@ton/core";
import type { TonLiteBlockLinkBack } from "./ton-lite-signature-proof";
import {
  parseTonMerkleProofBoc,
  type TonProofBlockId,
  type TonProofResourceLimits,
} from "./ton-proof-envelope";
import { canonicalTonShardId } from "./ton-shard-ident";

const BLOCK_TAG = 0x11ef55aa;
const BLOCK_INFO_TAG = 0x9bc7a987;
const SHARD_STATE_TAG = 0x9023afe2;
const MASTERCHAIN_STATE_EXTRA_TAG = 0xcc26;
const MASTERCHAIN_SHARD = "-9223372036854775808";

export interface TonBackwardLinkProofExpectation {
  globalId: number;
  authenticatedSourceBlock: TonProofBlockId;
  limits: TonProofResourceLimits;
}

export interface TonVerifiedBackwardBlockLink {
  kind: "TON_VERIFIED_BACKWARD_BLOCK_LINK";
  authenticatedSourceVerified: true;
  sourceProofVerified: true;
  sourceStateProofVerified: true;
  previousBlockDictionaryInclusionVerified: true;
  destinationProofVerified: true;
  headerBindingVerified: true;
  linkVerified: true;
  finalityProven: false;
  sourceBlock: TonProofBlockId;
  destinationBlock: TonProofBlockId;
  destinationIsKeyBlock: boolean;
  destinationGeneratedAtUnix: number;
  sourceStateHash: string;
  sourceProofRootHash: string;
  sourceStateProofRootHash: string;
  destinationProofRootHash: string;
}

export class TonBackwardLinkProofError extends Error {
  readonly name = "TonBackwardLinkProofError";
}

function reject(message: string): never {
  throw new TonBackwardLinkProofError(message);
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

function parseLabel(source: Slice, remaining: number): string {
  let repeated: boolean | undefined;
  let length: number;
  if (!source.loadBit()) {
    length = 0;
    while (source.loadBit()) {
      length += 1;
      if (length > remaining) reject("previous-block dictionary label is too long");
    }
  } else if (!source.loadBit()) {
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("previous-block dictionary label is too long");
  } else {
    repeated = source.loadBit();
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("previous-block dictionary label is too long");
  }
  let label = "";
  for (let index = 0; index < length; index += 1) {
    label += (repeated ?? source.loadBit()) ? "1" : "0";
  }
  return label;
}

function skipKeyMaxLt(source: Slice): void {
  source.loadBit();
  source.loadUintBig(64);
}

function lookupPreviousBlock(
  node: Cell,
  key: string,
  offset: number,
  remaining: number,
): { keyBlock: boolean; block: TonProofBlockId } | null {
  if (node.type === CellType.PrunedBranch) {
    reject("previous-block dictionary path is hidden by pruning");
  }
  if (node.type !== CellType.Ordinary) {
    reject("previous-block dictionary path contains an exotic cell");
  }
  const source = node.beginParse();
  const label = parseLabel(source, remaining);
  const afterLabel = remaining - label.length;
  if (label !== key.slice(offset, offset + label.length)) return null;
  offset += label.length;
  if (afterLabel === 0) {
    skipKeyMaxLt(source);
    const keyBlock = source.loadBit();
    source.loadUintBig(64); // end_lt is authenticated but not an external BlockIdExt field
    const block = {
      workchain: -1,
      shard: MASTERCHAIN_SHARD,
      seqno: source.loadUint(32),
      rootHash: source.loadBuffer(32).toString("hex"),
      fileHash: source.loadBuffer(32).toString("hex"),
    };
    source.endParse();
    return { keyBlock, block };
  }
  const left = source.loadRef();
  const right = source.loadRef();
  skipKeyMaxLt(source);
  source.endParse();
  return lookupPreviousBlock(
    key[offset] === "0" ? left : right,
    key,
    offset + 1,
    afterLabel - 1,
  );
}

function parseHeader(
  root: Cell,
  expected: TonProofBlockId,
  globalId: number,
  requireStateHash: boolean,
): { generatedAtUnix: number; keyBlock: boolean; newStateHash: string | null } {
  if (root.type !== CellType.Ordinary || root.hash(0).toString("hex") !== expected.rootHash) {
    reject("block header proof does not match its BlockIdExt");
  }
  try {
    const block = root.beginParse();
    if (block.loadUint(32) !== BLOCK_TAG) reject("header proof is not a TON Block");
    if (block.loadInt(32) !== globalId) reject("header proof global_id is not trusted");
    const infoCell = block.loadRef();
    block.loadRef();
    const stateUpdate = block.loadRef();
    block.loadRef();
    block.endParse();
    if (infoCell.type !== CellType.Ordinary) reject("BlockInfo is absent");
    const info = infoCell.beginParse();
    if (info.loadUint(32) !== BLOCK_INFO_TAG || info.loadUint(32) !== 0) {
      reject("BlockInfo header is unsupported");
    }
    const notMaster = info.loadBit();
    const afterMerge = info.loadBit();
    const beforeSplit = info.loadBit();
    const afterSplit = info.loadBit();
    info.loadBit();
    info.loadBit();
    const keyBlock = info.loadBit();
    const verticalSeqnoIncrement = info.loadBit();
    const flags = info.loadUint(8);
    if (flags > 1) reject("BlockInfo flags are unsupported");
    const seqno = info.loadUint(32);
    info.loadUint(32);
    const shard = loadShardIdent(info);
    const generatedAtUnix = info.loadUint(32);
    const startLt = info.loadUintBig(64);
    const endLt = info.loadUintBig(64);
    info.loadUint(32);
    info.loadUint(32);
    const minReferencedSeqno = info.loadUint(32);
    info.loadUint(32);
    if ((flags & 1) !== 0) {
      if (info.loadUint(8) !== 0xc4) reject("GlobalVersion tag is invalid");
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
      seqno !== expected.seqno ||
      shard.workchainId !== -1 ||
      shard.shardPrefixBits !== 0 ||
      canonicalTonShardId(shard) !== MASTERCHAIN_SHARD ||
      startLt >= endLt ||
      minReferencedSeqno > seqno
    ) {
      reject("BlockInfo identity is invalid");
    }
    if (!requireStateHash) {
      return { generatedAtUnix, keyBlock, newStateHash: null };
    }
    if (stateUpdate.type !== CellType.MerkleUpdate) {
      reject("source state_update is not a MerkleUpdate");
    }
    const update = exoticMerkleUpdate(stateUpdate.bits, stateUpdate.refs);
    return {
      generatedAtUnix,
      keyBlock,
      newStateHash: update.proofHash2.toString("hex"),
    };
  } catch (error) {
    if (error instanceof TonBackwardLinkProofError) throw error;
    reject(`block header proof is malformed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function verifyPreviousBlockInState(
  stateRoot: Cell,
  globalId: number,
  sourceBlock: TonProofBlockId,
  destinationBlock: TonProofBlockId,
  destinationIsKeyBlock: boolean,
): void {
  if (stateRoot.type !== CellType.Ordinary) reject("source state root is absent");
  try {
    const state = stateRoot.beginParse();
    if (state.loadUint(32) !== SHARD_STATE_TAG) reject("source state tag is invalid");
    const stateGlobalId = state.loadInt(32);
    const shard = loadShardIdent(state);
    const seqno = state.loadUint(32);
    state.loadUint(32);
    state.loadUint(32);
    state.loadUintBig(64);
    state.loadUint(32);
    state.loadRef();
    const beforeSplit = state.loadBit();
    state.loadRef();
    state.loadRef();
    if (!state.loadBit()) reject("source state has no McStateExtra");
    const extraCell = state.loadRef();
    state.endParse();
    if (
      stateGlobalId !== globalId ||
      seqno !== sourceBlock.seqno ||
      shard.workchainId !== -1 ||
      shard.shardPrefixBits !== 0 ||
      canonicalTonShardId(shard) !== MASTERCHAIN_SHARD ||
      beforeSplit
    ) {
      reject("source state identity is invalid");
    }
    if (extraCell.type !== CellType.Ordinary) reject("McStateExtra is hidden by pruning");
    const extra = extraCell.beginParse();
    if (extra.loadUint(16) !== MASTERCHAIN_STATE_EXTRA_TAG) {
      reject("McStateExtra tag is invalid");
    }
    extra.loadMaybeRef();
    extra.loadBuffer(32);
    extra.loadRef();
    const metadata = extra.loadRef();
    if (metadata.type !== CellType.Ordinary) {
      reject("previous-block metadata is hidden by pruning");
    }
    const values = metadata.beginParse();
    const flags = values.loadUint(16);
    if (flags > 1) reject("McStateExtra metadata flags are unsupported");
    values.loadUint(32);
    values.loadUint(32);
    values.loadBit();
    if (!values.loadBit()) reject("previous-block dictionary is empty");
    const root = values.loadRef();
    skipKeyMaxLt(values);
    const found = lookupPreviousBlock(
      root,
      destinationBlock.seqno.toString(2).padStart(32, "0"),
      0,
      32,
    );
    if (!found || !blockIdsEqual(found.block, destinationBlock)) {
      reject("destination is not the exact previous masterchain block in source state");
    }
    if (found.keyBlock !== destinationIsKeyBlock) {
      reject("destination key-block flag differs from source state");
    }
  } catch (error) {
    if (error instanceof TonBackwardLinkProofError) throw error;
    reject(`source state proof is malformed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export function verifyTonBackwardBlockLink(
  link: TonLiteBlockLinkBack,
  expectation: TonBackwardLinkProofExpectation,
): TonVerifiedBackwardBlockLink {
  if (!blockIdsEqual(link.from, expectation.authenticatedSourceBlock)) {
    reject("backward link source is not the authenticated block");
  }
  if (
    link.from.workchain !== -1 ||
    link.to.workchain !== -1 ||
    link.from.shard !== MASTERCHAIN_SHARD ||
    link.to.shard !== MASTERCHAIN_SHARD ||
    link.to.seqno >= link.from.seqno
  ) {
    reject("backward link endpoints are invalid");
  }
  const sourceProof = parseTonMerkleProofBoc(
    link.proof,
    expectation.limits,
    "backward_source_header",
  );
  const source = parseHeader(
    sourceProof.virtualRoot,
    link.from,
    expectation.globalId,
    true,
  );
  const stateProof = parseTonMerkleProofBoc(
    link.stateProof,
    expectation.limits,
    "backward_source_state",
  );
  if (stateProof.virtualRootHash !== source.newStateHash) {
    reject("source state proof does not match the authenticated source header");
  }
  verifyPreviousBlockInState(
    stateProof.virtualRoot,
    expectation.globalId,
    link.from,
    link.to,
    link.toKeyBlock,
  );
  const destinationProof = parseTonMerkleProofBoc(
    link.destProof,
    expectation.limits,
    "backward_destination_header",
  );
  const destination = parseHeader(
    destinationProof.virtualRoot,
    link.to,
    expectation.globalId,
    false,
  );
  if (destination.keyBlock !== link.toKeyBlock) {
    reject("destination header key-block flag differs from the link");
  }
  return {
    kind: "TON_VERIFIED_BACKWARD_BLOCK_LINK",
    authenticatedSourceVerified: true,
    sourceProofVerified: true,
    sourceStateProofVerified: true,
    previousBlockDictionaryInclusionVerified: true,
    destinationProofVerified: true,
    headerBindingVerified: true,
    linkVerified: true,
    finalityProven: false,
    sourceBlock: { ...link.from },
    destinationBlock: { ...link.to },
    destinationIsKeyBlock: link.toKeyBlock,
    destinationGeneratedAtUnix: destination.generatedAtUnix,
    sourceStateHash: source.newStateHash!,
    sourceProofRootHash: sourceProof.rootHash,
    sourceStateProofRootHash: stateProof.rootHash,
    destinationProofRootHash: destinationProof.rootHash,
  };
}
