import { Cell, CellType, loadCurrencyCollection, loadShardIdent } from "@ton/core";
import type { TonProvenMasterchainCheckpointChain } from "./ton-checkpoint-chain";
import type { TonProvenMasterchainHeader } from "./ton-masterchain-header-proof";
import type {
  TonProofBlockId,
  TonProofResourceLimits,
} from "./ton-proof-envelope";
import { parseTonMerkleProofBoc } from "./ton-proof-envelope";
import { canonicalTonShardId } from "./ton-shard-ident";

const SHARD_STATE_TAG = 0x9023afe2;
const MASTERCHAIN_STATE_EXTRA_TAG = 0xcc26;
const MASTERCHAIN_SHARD = "-9223372036854775808";

export interface TonTvmEnvironmentProofExpectation {
  limits: TonProofResourceLimits;
}

export interface TonProvenTvmEnvironment {
  kind: "TON_PROVEN_TVM_ENVIRONMENT";
  masterchainFinalityProven: true;
  masterchainStateProofVerified: true;
  configurationDictionaryProofVerified: true;
  configurationComplete: true;
  localGetterExecutionVerified: false;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  networkGlobalId: number;
  masterchainBlock: TonProofBlockId;
  masterchainStateHash: string;
  masterchainStateProofRootHash: string;
  generatedAtUnix: number;
  generatedLt: string;
  configurationAddress: string;
  configurationRootHash: string;
  configurationRoot: Cell;
}

export class TonTvmEnvironmentProofError extends Error {
  readonly name = "TonTvmEnvironmentProofError";
}

function reject(message: string): never {
  throw new TonTvmEnvironmentProofError(message);
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

function requireCompleteOrdinaryGraph(root: Cell): void {
  const visited = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const cell = pending.pop()!;
    const identity = `${cell.type}:${cell.hash(0).toString("hex")}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    if (cell.type === CellType.PrunedBranch) {
      reject("configuration dictionary contains a pruned branch");
    }
    if (cell.type !== CellType.Ordinary) {
      reject("configuration dictionary contains an exotic cell");
    }
    pending.push(...cell.refs);
  }
}

export function verifyTonTvmEnvironmentProof(
  chain: TonProvenMasterchainCheckpointChain,
  header: TonProvenMasterchainHeader,
  stateProofBoc: Buffer,
  expectation: TonTvmEnvironmentProofExpectation,
): TonProvenTvmEnvironment {
  if (
    chain.masterchainFinalityProven !== true ||
    chain.finalityProven !== true ||
    chain.authorizationAllowed !== false ||
    chain.verificationEvidenceHash !== null
  ) {
    reject("checkpoint-chain provenance is invalid");
  }
  if (
    header.rootHashVerified !== true ||
    header.fileHashVerified !== false ||
    header.signaturesVerified !== false ||
    header.finalityProven !== false ||
    !blockIdsEqual(chain.targetBlock, header.block) ||
    chain.networkGlobalId !== header.globalId ||
    chain.targetGeneratedAtUnix !== header.generatedAtUnix
  ) {
    reject("masterchain header is not bound to the finalized checkpoint target");
  }

  const proof = parseTonMerkleProofBoc(
    stateProofBoc,
    expectation.limits,
    "masterchain_state_proof",
  );
  if (proof.virtualRootHash !== header.newStateHash) {
    reject("masterchain state proof does not match the finalized block state update");
  }
  if (proof.virtualRoot.type !== CellType.Ordinary) {
    reject("masterchain state root is absent");
  }

  try {
    const state = proof.virtualRoot.beginParse();
    if (state.loadUint(32) !== SHARD_STATE_TAG) {
      reject("state proof does not contain ShardStateUnsplit");
    }
    const globalId = state.loadInt(32);
    const shard = loadShardIdent(state);
    const seqno = state.loadUint(32);
    const verticalSeqno = state.loadUint(32);
    const generatedAtUnix = state.loadUint(32);
    const generatedLt = state.loadUintBig(64);
    const minimumReferencedSeqno = state.loadUint(32);
    state.loadRef(); // OutMsgQueueInfo
    const beforeSplit = state.loadBit();
    state.loadRef(); // ShardAccounts
    state.loadRef(); // balances, libraries and master reference
    if (!state.loadBit()) reject("masterchain state has no McStateExtra");
    const extraCell = state.loadRef();
    state.endParse();

    if (
      globalId !== header.globalId ||
      shard.workchainId !== -1 ||
      shard.shardPrefixBits !== 0 ||
      canonicalTonShardId(shard) !== MASTERCHAIN_SHARD ||
      seqno !== header.block.seqno ||
      verticalSeqno !== header.verticalSeqno ||
      generatedAtUnix !== header.generatedAtUnix ||
      generatedLt.toString() !== header.endLt ||
      minimumReferencedSeqno !== header.minReferencedMasterchainSeqno ||
      beforeSplit
    ) {
      reject("masterchain state identity does not match the finalized header");
    }
    if (extraCell.type !== CellType.Ordinary) {
      reject("masterchain state extra is hidden by pruning");
    }
    const extra = extraCell.beginParse();
    if (extra.loadUint(16) !== MASTERCHAIN_STATE_EXTRA_TAG) {
      reject("masterchain state extra tag is invalid");
    }
    extra.loadMaybeRef(); // ShardHashes; unrelated branches may remain pruned
    const configurationAddress = extra.loadBuffer(32).toString("hex");
    if (configurationAddress === "0".repeat(64)) {
      reject("configuration address is zero");
    }
    const configurationRoot = extra.loadRef();
    extra.loadRef(); // validator and previous-block metadata
    loadCurrencyCollection(extra);
    extra.endParse();
    requireCompleteOrdinaryGraph(configurationRoot);

    return {
      kind: "TON_PROVEN_TVM_ENVIRONMENT",
      masterchainFinalityProven: true,
      masterchainStateProofVerified: true,
      configurationDictionaryProofVerified: true,
      configurationComplete: true,
      localGetterExecutionVerified: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      networkGlobalId: header.globalId,
      masterchainBlock: { ...header.block },
      masterchainStateHash: header.newStateHash,
      masterchainStateProofRootHash: proof.rootHash,
      generatedAtUnix,
      generatedLt: generatedLt.toString(),
      configurationAddress,
      configurationRootHash: configurationRoot.hash(0).toString("hex"),
      configurationRoot,
    };
  } catch (error) {
    if (error instanceof TonTvmEnvironmentProofError) throw error;
    reject(
      `masterchain TVM environment proof is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
