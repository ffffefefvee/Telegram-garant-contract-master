import {
  Cell,
  CellType,
  loadCurrencyCollection,
  loadShardIdent,
  Slice,
} from "@ton/core";
import type { TonProvenMasterchainCheckpointChain } from "./ton-checkpoint-chain";
import {
  lookupTonHashmapRef,
  TonForwardLinkProofError,
} from "./ton-forward-link-proof";
import type { TonProvenMasterchainHeader } from "./ton-masterchain-header-proof";
import type {
  TonProofBlockId,
  TonProofResourceLimits,
} from "./ton-proof-envelope";
import { parseTonMerkleProofBoc } from "./ton-proof-envelope";

const SHARD_STATE_TAG = 0x9023afe2;
const MASTERCHAIN_STATE_EXTRA_TAG = 0xcc26;
const MASTERCHAIN_SHARD = "-9223372036854775808";
const SHARD_DESCRIPTOR_TAG = 0xb;
const SHARD_DESCRIPTOR_NEW_TAG = 0xa;
const ZERO_HASH = "0".repeat(64);

export interface TonShardDescriptorExpectation {
  workchain: 0;
  shard: string;
  limits: TonProofResourceLimits;
}

export interface TonProvenShardDescriptor {
  kind: "TON_PROVEN_SHARD_DESCRIPTOR";
  masterchainFinalityProven: true;
  masterchainStateProofVerified: true;
  shardDictionaryInclusionVerified: true;
  shardPrefixVerified: true;
  shardDescriptorFinalityProven: true;
  shardBlockProofVerified: false;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  masterchainBlock: TonProofBlockId;
  masterchainStateHash: string;
  masterchainStateProofRootHash: string;
  workchain: 0;
  shard: string;
  shardPrefixBits: number;
  block: TonProofBlockId;
  registeredAtMasterchainSeqno: number;
  startLt: string;
  endLt: string;
  beforeSplit: boolean;
  beforeMerge: boolean;
  wantSplit: boolean;
  wantMerge: boolean;
  nextCatchainUpdated: boolean;
  nextCatchainSeqno: number;
  nextValidatorShard: string;
  minimumReferencedMasterchainSeqno: number;
  generatedAtUnix: number;
  futureSplitMerge:
    | { kind: "none" }
    | { kind: "split" | "merge"; atUnix: number; intervalSeconds: number };
}

export class TonShardDescriptorProofError extends Error {
  readonly name = "TonShardDescriptorProofError";
}

function reject(message: string): never {
  throw new TonShardDescriptorProofError(message);
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

function signedUint64(value: bigint): string {
  return (value >= 1n << 63n ? value - (1n << 64n) : value).toString();
}

function parseShard(value: string): { raw: bigint; prefixBits: number } {
  if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)) {
    reject("shard is not canonical");
  }
  let signed: bigint;
  try {
    signed = BigInt(value);
  } catch {
    reject("shard is invalid");
  }
  if (signed < -(1n << 63n) || signed > (1n << 63n) - 1n) {
    reject("shard is outside int64");
  }
  const raw = BigInt.asUintN(64, signed);
  if (raw === 0n) reject("shard identifier is zero");
  let trailingZeroes = 0;
  let cursor = raw;
  while ((cursor & 1n) === 0n) {
    trailingZeroes += 1;
    cursor >>= 1n;
  }
  const prefixBits = 63 - trailingZeroes;
  if (prefixBits < 0 || prefixBits > 60) {
    reject("shard prefix length is outside TON bounds");
  }
  return { raw, prefixBits };
}

function parseMasterchainState(
  root: Cell,
  expectedGlobalId: number,
): {
  globalId: number;
  seqno: number;
  generatedAtUnix: number;
  shardHashesRoot: Cell;
} {
  if (root.type !== CellType.Ordinary)
    reject("masterchain state root is absent");
  try {
    const state = root.beginParse();
    if (state.loadUint(32) !== SHARD_STATE_TAG) {
      reject("state proof does not contain ShardStateUnsplit");
    }
    const globalId = state.loadInt(32);
    const shard = loadShardIdent(state);
    const seqno = state.loadUint(32);
    state.loadUint(32); // vertical sequence
    const generatedAtUnix = state.loadUint(32);
    state.loadUintBig(64); // generation logical time
    const minimumReferencedSeqno = state.loadUint(32);
    state.loadRef(); // OutMsgQueueInfo
    const beforeSplit = state.loadBit();
    state.loadRef(); // ShardAccounts
    state.loadRef(); // histories, balances, libraries and master ref
    if (!state.loadBit()) reject("masterchain state has no McStateExtra");
    const extraCell = state.loadRef();
    state.endParse();
    if (
      globalId !== expectedGlobalId ||
      shard.workchainId !== -1 ||
      shard.shardPrefixBits !== 0 ||
      signedUint64(shard.shardPrefix) !== MASTERCHAIN_SHARD ||
      beforeSplit ||
      minimumReferencedSeqno > seqno
    ) {
      reject("masterchain state identity is invalid");
    }
    if (extraCell.type !== CellType.Ordinary) {
      reject("masterchain state extra is hidden by pruning");
    }
    const extra = extraCell.beginParse();
    if (extra.loadUint(16) !== MASTERCHAIN_STATE_EXTRA_TAG) {
      reject("masterchain state extra tag is invalid");
    }
    const shardHashesRoot = extra.loadMaybeRef();
    if (!shardHashesRoot || shardHashesRoot.type !== CellType.Ordinary) {
      reject("ShardHashes root is absent or hidden by pruning");
    }
    extra.loadBuffer(32); // configuration address
    extra.loadRef(); // configuration dictionary
    extra.loadRef(); // validator/previous-block metadata bracket
    loadCurrencyCollection(extra);
    extra.endParse();
    return { globalId, seqno, generatedAtUnix, shardHashesRoot };
  } catch (error) {
    if (error instanceof TonShardDescriptorProofError) throw error;
    reject(
      `masterchain state proof is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function parseFutureSplitMerge(
  source: Slice,
): TonProvenShardDescriptor["futureSplitMerge"] {
  if (!source.loadBit()) return { kind: "none" };
  const kind = source.loadBit() ? "merge" : "split";
  return {
    kind,
    atUnix: source.loadUint(32),
    intervalSeconds: source.loadUint(32),
  };
}

function parseCurrencyPair(source: Slice): void {
  loadCurrencyCollection(source);
  loadCurrencyCollection(source);
  source.endParse();
}

function parseDescriptor(
  source: Slice,
  expectation: TonShardDescriptorExpectation,
  prefixBits: number,
  masterchainSeqno: number,
): Omit<
  TonProvenShardDescriptor,
  | "kind"
  | "masterchainFinalityProven"
  | "masterchainStateProofVerified"
  | "shardDictionaryInclusionVerified"
  | "shardPrefixVerified"
  | "shardDescriptorFinalityProven"
  | "shardBlockProofVerified"
  | "authorizationAllowed"
  | "verificationEvidenceHash"
  | "masterchainBlock"
  | "masterchainStateHash"
  | "masterchainStateProofRootHash"
> {
  const tag = source.loadUint(4);
  if (tag !== SHARD_DESCRIPTOR_TAG && tag !== SHARD_DESCRIPTOR_NEW_TAG) {
    reject("ShardDescr tag is unsupported");
  }
  const seqno = source.loadUint(32);
  const registeredAtMasterchainSeqno = source.loadUint(32);
  const startLt = source.loadUintBig(64);
  const endLt = source.loadUintBig(64);
  const rootHash = source.loadBuffer(32).toString("hex");
  const fileHash = source.loadBuffer(32).toString("hex");
  const beforeSplit = source.loadBit();
  const beforeMerge = source.loadBit();
  const wantSplit = source.loadBit();
  const wantMerge = source.loadBit();
  const nextCatchainUpdated = source.loadBit();
  if (source.loadUint(3) !== 0) reject("ShardDescr flags are nonzero");
  const nextCatchainSeqno = source.loadUint(32);
  const nextValidatorShard = source.loadUintBig(64);
  const minimumReferencedMasterchainSeqno = source.loadUint(32);
  const generatedAtUnix = source.loadUint(32);
  const futureSplitMerge = parseFutureSplitMerge(source);
  if (tag === SHARD_DESCRIPTOR_TAG) {
    parseCurrencyPair(source);
  } else {
    const currencies = source.loadRef();
    source.endParse();
    if (currencies.type !== CellType.Ordinary) {
      reject("ShardDescr currency pair is hidden by pruning");
    }
    parseCurrencyPair(currencies.beginParse());
  }
  if (
    seqno === 0 ||
    startLt >= endLt ||
    rootHash === ZERO_HASH ||
    fileHash === ZERO_HASH ||
    registeredAtMasterchainSeqno > masterchainSeqno ||
    minimumReferencedMasterchainSeqno > masterchainSeqno
  ) {
    reject("ShardDescr identity or logical-time metadata is invalid");
  }
  return {
    workchain: expectation.workchain,
    shard: expectation.shard,
    shardPrefixBits: prefixBits,
    block: {
      workchain: expectation.workchain,
      shard: expectation.shard,
      seqno,
      rootHash,
      fileHash,
    },
    registeredAtMasterchainSeqno,
    startLt: startLt.toString(),
    endLt: endLt.toString(),
    beforeSplit,
    beforeMerge,
    wantSplit,
    wantMerge,
    nextCatchainUpdated,
    nextCatchainSeqno,
    nextValidatorShard: signedUint64(nextValidatorShard),
    minimumReferencedMasterchainSeqno,
    generatedAtUnix,
    futureSplitMerge,
  };
}

function selectShardDescriptor(
  treeRoot: Cell,
  expectation: TonShardDescriptorExpectation,
  masterchainSeqno: number,
): ReturnType<typeof parseDescriptor> {
  const shard = parseShard(expectation.shard);
  let node = treeRoot;
  let depth = 0;
  for (;;) {
    if (node.type === CellType.PrunedBranch) {
      reject("target shard path is hidden by pruning");
    }
    if (node.type !== CellType.Ordinary) {
      reject("target shard path contains a non-ordinary cell");
    }
    try {
      const source = node.beginParse();
      if (!source.loadBit()) {
        if (depth !== shard.prefixBits) {
          reject("ShardHashes leaf does not match the exact shard prefix");
        }
        return parseDescriptor(
          source,
          expectation,
          shard.prefixBits,
          masterchainSeqno,
        );
      }
      if (depth >= shard.prefixBits) {
        reject("ShardHashes forks below the exact shard prefix");
      }
      const left = source.loadRef();
      const right = source.loadRef();
      source.endParse();
      const bit = Number((shard.raw >> BigInt(63 - depth)) & 1n);
      node = bit === 0 ? left : right;
      depth += 1;
    } catch (error) {
      if (error instanceof TonShardDescriptorProofError) throw error;
      reject(
        `ShardHashes tree is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}

export function verifyTonShardDescriptorProof(
  chain: TonProvenMasterchainCheckpointChain,
  header: TonProvenMasterchainHeader,
  stateProofBoc: Buffer,
  expectation: TonShardDescriptorExpectation,
): TonProvenShardDescriptor {
  if (
    chain.masterchainFinalityProven !== true ||
    chain.finalityProven !== true ||
    chain.authorizationAllowed !== false ||
    chain.verificationEvidenceHash !== null
  ) {
    reject("masterchain checkpoint provenance is invalid");
  }
  if (!blockIdsEqual(chain.targetBlock, header.block)) {
    reject("masterchain header does not match the finalized target");
  }
  if (expectation.workchain !== 0) reject("only base workchain 0 is supported");
  const stateProof = parseTonMerkleProofBoc(
    stateProofBoc,
    expectation.limits,
    "shard_descriptor_state_proof",
  );
  if (stateProof.virtualRootHash !== header.newStateHash) {
    reject("state proof does not match the finalized block state-update hash");
  }
  const state = parseMasterchainState(
    stateProof.virtualRoot,
    chain.networkGlobalId,
  );
  if (
    state.seqno !== chain.targetBlock.seqno ||
    state.generatedAtUnix !== header.generatedAtUnix
  ) {
    reject("masterchain state does not match the finalized block metadata");
  }
  let workchainLookup;
  try {
    workchainLookup = lookupTonHashmapRef(
      state.shardHashesRoot,
      expectation.workchain.toString(2).padStart(32, "0"),
    );
  } catch (error) {
    if (error instanceof TonForwardLinkProofError) {
      reject(error.message);
    }
    throw error;
  }
  if (workchainLookup.status !== "present") {
    reject(
      workchainLookup.status === "unproven"
        ? "target workchain path is hidden by pruning"
        : "target workchain is proven absent",
    );
  }
  const descriptor = selectShardDescriptor(
    workchainLookup.value,
    expectation,
    chain.targetBlock.seqno,
  );
  return {
    kind: "TON_PROVEN_SHARD_DESCRIPTOR",
    masterchainFinalityProven: true,
    masterchainStateProofVerified: true,
    shardDictionaryInclusionVerified: true,
    shardPrefixVerified: true,
    shardDescriptorFinalityProven: true,
    shardBlockProofVerified: false,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    masterchainBlock: { ...chain.targetBlock },
    masterchainStateHash: header.newStateHash,
    masterchainStateProofRootHash: stateProof.rootHash,
    ...descriptor,
  };
}
