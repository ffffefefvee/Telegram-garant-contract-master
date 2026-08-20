import { Cell, CellType, exoticMerkleUpdate, loadShardIdent } from "@ton/core";
import type {
  TonProofBlockId,
  TonProofResourceLimits,
} from "./ton-proof-envelope";
import { parseTonMerkleProofBoc } from "./ton-proof-envelope";
import type { TonProvenShardDescriptor } from "./ton-shard-descriptor-proof";

const BLOCK_TAG = 0x11ef55aa;
const BLOCK_INFO_TAG = 0x9bc7a987;
const GLOBAL_VERSION_TAG = 0xc4;
const MASTERCHAIN_SHARD = "-9223372036854775808";

export interface TonShardBlockProofExpectation {
  limits: TonProofResourceLimits;
}

export interface TonProvenShardBlockHeader {
  kind: "TON_PROVEN_SHARD_BLOCK_HEADER";
  shardDescriptorFinalityProven: true;
  shardBlockProofVerified: true;
  shardBlockFinalityProven: true;
  shardStateProofVerified: false;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  networkGlobalId: number;
  block: TonProofBlockId;
  version: number;
  verticalSeqno: number;
  generatedAtUnix: number;
  startLt: string;
  endLt: string;
  afterMerge: boolean;
  beforeSplit: boolean;
  afterSplit: boolean;
  wantSplit: boolean;
  wantMerge: boolean;
  validatorListHashShort: number;
  catchainSeqno: number;
  minimumReferencedMasterchainSeqno: number;
  masterchainReference: TonProofBlockId & { endLt: string };
  previousBlocks: readonly (TonProofBlockId & { endLt: string })[];
  previousVerticalBlock: (TonProofBlockId & { endLt: string }) | null;
  oldStateHash: string;
  newStateHash: string;
  proofRootHash: string;
}

interface ExtBlockRef {
  endLt: bigint;
  seqno: number;
  rootHash: string;
  fileHash: string;
}

export class TonShardBlockProofError extends Error {
  readonly name = "TonShardBlockProofError";
}

function reject(message: string): never {
  throw new TonShardBlockProofError(message);
}

function rawShard(value: string): bigint {
  try {
    return BigInt.asUintN(64, BigInt(value));
  } catch {
    reject("descriptor shard is invalid");
  }
}

function signedShard(value: bigint): string {
  return (value >= 1n << 63n ? value - (1n << 64n) : value).toString();
}

function shardLowerBit(value: bigint): bigint {
  const lower = value & -value;
  if (lower === 0n) reject("shard identifier is invalid");
  return lower;
}

function shardParent(value: bigint): bigint {
  const lower = shardLowerBit(value);
  if (lower >= 1n << 63n) reject("full shard has no parent");
  return BigInt.asUintN(64, (value - lower) | (lower << 1n));
}

function shardChildren(value: bigint): [bigint, bigint] {
  const lower = shardLowerBit(value);
  if (lower <= 1n) reject("leaf shard has no children");
  const delta = lower >> 1n;
  return [BigInt.asUintN(64, value - delta), BigInt.asUintN(64, value + delta)];
}

function parseExtBlockRef(cell: Cell, label: string): ExtBlockRef {
  if (cell.type !== CellType.Ordinary) reject(`${label} is hidden by pruning`);
  try {
    const source = cell.beginParse();
    const result = {
      endLt: source.loadUintBig(64),
      seqno: source.loadUint(32),
      rootHash: source.loadBuffer(32).toString("hex"),
      fileHash: source.loadBuffer(32).toString("hex"),
    };
    source.endParse();
    return result;
  } catch (error) {
    if (error instanceof TonShardBlockProofError) throw error;
    reject(
      `${label} is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function withIdentity(
  ref: ExtBlockRef,
  workchain: number,
  shard: string,
): TonProofBlockId & { endLt: string } {
  return {
    workchain,
    shard,
    seqno: ref.seqno,
    rootHash: ref.rootHash,
    fileHash: ref.fileHash,
    endLt: ref.endLt.toString(),
  };
}

function parsePreviousRefs(
  previousCell: Cell,
  afterMerge: boolean,
  afterSplit: boolean,
  block: TonProofBlockId,
): readonly (TonProofBlockId & { endLt: string })[] {
  const shard = rawShard(block.shard);
  if (afterMerge) {
    if (afterSplit) reject("shard block cannot be after merge and split");
    if (previousCell.type !== CellType.Ordinary) {
      reject("merged predecessor pair is hidden by pruning");
    }
    const pair = previousCell.beginParse();
    const first = parseExtBlockRef(pair.loadRef(), "previousBlocks[0]");
    const second = parseExtBlockRef(pair.loadRef(), "previousBlocks[1]");
    pair.endParse();
    if (first.seqno === 0 || second.seqno === 0) {
      reject("shards cannot merge immediately after initial state");
    }
    const children = shardChildren(shard);
    const maximum = Math.max(first.seqno, second.seqno);
    if (block.seqno !== maximum + 1) {
      reject("merged block sequence does not follow its ancestors");
    }
    return [
      withIdentity(first, block.workchain, signedShard(children[0])),
      withIdentity(second, block.workchain, signedShard(children[1])),
    ];
  }
  const previous = parseExtBlockRef(previousCell, "previousBlocks[0]");
  if (block.seqno !== previous.seqno + 1) {
    reject("shard block sequence does not follow its predecessor");
  }
  if (afterSplit && previous.seqno === 0) {
    reject("shard cannot split immediately after initial state");
  }
  return [
    withIdentity(
      previous,
      block.workchain,
      afterSplit ? signedShard(shardParent(shard)) : block.shard,
    ),
  ];
}

function parseStateUpdate(cell: Cell): {
  oldStateHash: string;
  newStateHash: string;
} {
  if (cell.type !== CellType.MerkleUpdate) {
    reject("shard block state_update is not a MerkleUpdate");
  }
  try {
    const update = exoticMerkleUpdate(cell.bits, cell.refs);
    return {
      oldStateHash: update.proofHash1.toString("hex"),
      newStateHash: update.proofHash2.toString("hex"),
    };
  } catch (error) {
    reject(
      `shard block state_update is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function verifyTonShardBlockProof(
  descriptor: TonProvenShardDescriptor,
  blockProofBoc: Buffer,
  expectation: TonShardBlockProofExpectation,
): TonProvenShardBlockHeader {
  if (
    descriptor.shardDescriptorFinalityProven !== true ||
    descriptor.shardBlockProofVerified !== false ||
    descriptor.authorizationAllowed !== false ||
    descriptor.verificationEvidenceHash !== null
  ) {
    reject("shard descriptor provenance is invalid");
  }
  const proof = parseTonMerkleProofBoc(
    blockProofBoc,
    expectation.limits,
    "shard_block_proof",
  );
  if (proof.virtualRootHash !== descriptor.block.rootHash) {
    reject("shard block proof does not match the finalized descriptor root");
  }
  const root = proof.virtualRoot;
  if (root.type !== CellType.Ordinary) reject("shard block root is absent");
  if (root.hash(0).toString("hex") !== descriptor.block.rootHash) {
    reject("shard block virtual root identity is invalid");
  }

  try {
    const blockRoot = root.beginParse();
    if (blockRoot.loadUint(32) !== BLOCK_TAG)
      reject("proof root is not a TON Block");
    if (blockRoot.loadInt(32) !== descriptor.networkGlobalId) {
      reject("shard block global_id is not finalized network");
    }
    const infoCell = blockRoot.loadRef();
    blockRoot.loadRef(); // ValueFlow
    const stateUpdateCell = blockRoot.loadRef();
    blockRoot.loadRef(); // BlockExtra
    blockRoot.endParse();
    if (infoCell.type !== CellType.Ordinary)
      reject("shard BlockInfo is absent");

    const info = infoCell.beginParse();
    if (info.loadUint(32) !== BLOCK_INFO_TAG)
      reject("shard BlockInfo tag is invalid");
    const version = info.loadUint(32);
    if (version !== 0) reject("shard BlockInfo version is unsupported");
    const notMaster = info.loadBit();
    const afterMerge = info.loadBit();
    const beforeSplit = info.loadBit();
    const afterSplit = info.loadBit();
    const wantSplit = info.loadBit();
    const wantMerge = info.loadBit();
    const keyBlock = info.loadBit();
    const verticalSeqnoIncrement = info.loadBit();
    const flags = info.loadUint(8);
    if (flags > 1) reject("shard BlockInfo flags are unsupported");
    const seqno = info.loadUint(32);
    const verticalSeqno = info.loadUint(32);
    const shard = loadShardIdent(info);
    const generatedAtUnix = info.loadUint(32);
    const startLt = info.loadUintBig(64);
    const endLt = info.loadUintBig(64);
    const validatorListHashShort = info.loadUint(32);
    const catchainSeqno = info.loadUint(32);
    const minimumReferencedMasterchainSeqno = info.loadUint(32);
    info.loadUint(32); // previous key block sequence is masterchain-only metadata
    if ((flags & 1) !== 0) {
      if (info.loadUint(8) !== GLOBAL_VERSION_TAG) {
        reject("shard GlobalVersion tag is invalid");
      }
      info.loadUint(32);
      info.loadUintBig(64);
    }
    const masterReferenceCell = info.loadRef();
    const previousCell = info.loadRef();
    const previousVerticalBlock = verticalSeqnoIncrement
      ? parseExtBlockRef(info.loadRef(), "previousVerticalBlock")
      : null;
    info.endParse();

    if (!notMaster || keyBlock) reject("BlockInfo is not a shardchain block");
    if (
      shard.workchainId !== descriptor.block.workchain ||
      signedShard(shard.shardPrefix) !== descriptor.block.shard ||
      seqno !== descriptor.block.seqno
    ) {
      reject("shard BlockInfo identity does not match the descriptor");
    }
    if (
      shard.shardPrefixBits !== descriptor.shardPrefixBits ||
      beforeSplit !== descriptor.beforeSplit ||
      wantSplit !== descriptor.wantSplit ||
      wantMerge !== descriptor.wantMerge ||
      generatedAtUnix !== descriptor.generatedAtUnix ||
      startLt.toString() !== descriptor.startLt ||
      endLt.toString() !== descriptor.endLt
    ) {
      reject("shard BlockInfo metadata does not match the descriptor");
    }
    if (verticalSeqno < Number(verticalSeqnoIncrement)) {
      reject("shard vertical sequence is invalid");
    }
    if (minimumReferencedMasterchainSeqno > descriptor.masterchainBlock.seqno) {
      reject("shard minimum masterchain reference is in the future");
    }

    const masterReference = parseExtBlockRef(
      masterReferenceCell,
      "masterchainReference",
    );
    if (
      masterReference.seqno > descriptor.masterchainBlock.seqno ||
      masterReference.seqno < minimumReferencedMasterchainSeqno
    ) {
      reject("shard masterchain reference is outside finalized bounds");
    }
    const previousBlocks = parsePreviousRefs(
      previousCell,
      afterMerge,
      afterSplit,
      descriptor.block,
    );
    const state = parseStateUpdate(stateUpdateCell);
    return {
      kind: "TON_PROVEN_SHARD_BLOCK_HEADER",
      shardDescriptorFinalityProven: true,
      shardBlockProofVerified: true,
      shardBlockFinalityProven: true,
      shardStateProofVerified: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      networkGlobalId: descriptor.networkGlobalId,
      block: { ...descriptor.block },
      version,
      verticalSeqno,
      generatedAtUnix,
      startLt: startLt.toString(),
      endLt: endLt.toString(),
      afterMerge,
      beforeSplit,
      afterSplit,
      wantSplit,
      wantMerge,
      validatorListHashShort,
      catchainSeqno,
      minimumReferencedMasterchainSeqno,
      masterchainReference: withIdentity(
        masterReference,
        -1,
        MASTERCHAIN_SHARD,
      ),
      previousBlocks,
      previousVerticalBlock: previousVerticalBlock
        ? withIdentity(
            previousVerticalBlock,
            descriptor.block.workchain,
            descriptor.block.shard,
          )
        : null,
      ...state,
      proofRootHash: proof.rootHash,
    };
  } catch (error) {
    if (error instanceof TonShardBlockProofError) throw error;
    reject(
      `shard block proof is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
