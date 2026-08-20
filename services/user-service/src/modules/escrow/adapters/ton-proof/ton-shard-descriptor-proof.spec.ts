import {
  beginCell,
  Cell,
  convertToMerkleProof,
  Dictionary,
  storeCurrencyCollection,
  storeShardIdent,
} from "@ton/core";
import type { TonProvenMasterchainCheckpointChain } from "./ton-checkpoint-chain";
import type { TonProvenMasterchainHeader } from "./ton-masterchain-header-proof";
import type { TonProofBlockId } from "./ton-proof-envelope";
import {
  TonShardDescriptorProofError,
  verifyTonShardDescriptorProof,
} from "./ton-shard-descriptor-proof";

const GLOBAL_ID = -3;
const MC_SHARD = "-9223372036854775808";
const LEFT_SHARD = "4611686018427387904";
const RIGHT_SHARD = "-4611686018427387904";

interface DescriptorOptions {
  tag?: number;
  seqno?: number;
  registeredAtMasterchainSeqno?: number;
  minimumReferencedMasterchainSeqno?: number;
  rootHash?: string;
  fileHash?: string;
  flags?: number;
  beforeSplit?: boolean;
  beforeMerge?: boolean;
  wantSplit?: boolean;
  wantMerge?: boolean;
  nextCatchainUpdated?: boolean;
  future?: "none" | "split" | "merge";
}

function descriptor(options: DescriptorOptions = {}): Cell {
  const tag = options.tag ?? 0xb;
  const builder = beginCell()
    .storeUint(tag, 4)
    .storeUint(options.seqno ?? 77, 32)
    .storeUint(options.registeredAtMasterchainSeqno ?? 115, 32)
    .storeUint(10_000n, 64)
    .storeUint(20_000n, 64)
    .storeBuffer(Buffer.from(options.rootHash ?? "a".repeat(64), "hex"))
    .storeBuffer(Buffer.from(options.fileHash ?? "b".repeat(64), "hex"))
    .storeBit(options.beforeSplit ?? false)
    .storeBit(options.beforeMerge ?? false)
    .storeBit(options.wantSplit ?? false)
    .storeBit(options.wantMerge ?? false)
    .storeBit(options.nextCatchainUpdated ?? false)
    .storeUint(options.flags ?? 0, 3)
    .storeUint(9, 32)
    .storeUint(1n << 63n, 64)
    .storeUint(options.minimumReferencedMasterchainSeqno ?? 100, 32)
    .storeUint(1_800_000_190, 32);
  const future = options.future ?? "none";
  if (future === "none") {
    builder.storeBit(false);
  } else {
    builder
      .storeBit(true)
      .storeBit(future === "merge")
      .storeUint(1_800_000_300, 32)
      .storeUint(60, 32);
  }
  const currencies = beginCell()
    .store(storeCurrencyCollection({ coins: 0n }))
    .store(storeCurrencyCollection({ coins: 0n }))
    .endCell();
  if (tag === 0xb) {
    builder.storeSlice(currencies.beginParse());
  } else {
    builder.storeRef(currencies);
  }
  return builder.endCell();
}

function leaf(value: Cell): Cell {
  return beginCell().storeBit(false).storeSlice(value.beginParse()).endCell();
}

function fork(left: Cell, right: Cell): Cell {
  return beginCell().storeBit(true).storeRef(left).storeRef(right).endCell();
}

function pruned(cell: Cell): Cell {
  return beginCell()
    .storeUint(1, 8)
    .storeUint(1, 8)
    .storeBuffer(cell.hash(0))
    .storeUint(cell.depth(0), 16)
    .endCell({ exotic: true });
}

function masterchainState(input?: {
  tree?: Cell;
  seqno?: number;
  generatedAtUnix?: number;
  globalId?: number;
  workchain?: number;
  beforeSplit?: boolean;
}): Cell {
  const tree = input?.tree ?? leaf(descriptor());
  const shardHashes = Dictionary.empty(
    Dictionary.Keys.Int(32),
    Dictionary.Values.Cell(),
  );
  shardHashes.set(0, tree);
  const dummy = beginCell().storeBit(false).endCell();
  const extra = beginCell()
    .storeUint(0xcc26, 16)
    .storeDict(shardHashes)
    .storeBuffer(Buffer.alloc(32, 0xc1))
    .storeRef(dummy)
    .storeRef(dummy)
    .store(storeCurrencyCollection({ coins: 0n }))
    .endCell();
  return beginCell()
    .storeUint(0x9023afe2, 32)
    .storeInt(input?.globalId ?? GLOBAL_ID, 32)
    .store(
      storeShardIdent({
        shardPrefixBits: 0,
        workchainId: input?.workchain ?? -1,
        shardPrefix: 1n << 63n,
      }),
    )
    .storeUint(input?.seqno ?? 115, 32)
    .storeUint(0, 32)
    .storeUint(input?.generatedAtUnix ?? 1_800_000_200, 32)
    .storeUint(30_000n, 64)
    .storeUint(100, 32)
    .storeRef(dummy)
    .storeBit(input?.beforeSplit ?? false)
    .storeRef(dummy)
    .storeRef(dummy)
    .storeBit(true)
    .storeRef(extra)
    .endCell();
}

function blockId(): TonProofBlockId {
  return {
    workchain: -1,
    shard: MC_SHARD,
    seqno: 115,
    rootHash: "1".repeat(64),
    fileHash: "2".repeat(64),
  };
}

function chain(target = blockId()): TonProvenMasterchainCheckpointChain {
  return {
    kind: "TON_PROVEN_MASTERCHAIN_CHECKPOINT_CHAIN",
    proofDecoded: true,
    endpointsVerified: true,
    completenessVerified: true,
    allLinksVerified: true,
    supportedConsensusVerified: true,
    ordinaryConsensusVerified: true,
    simplexConsensusVerified: false,
    masterchainFinalityProven: true,
    finalityProven: true,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: GLOBAL_ID,
    policyVersion: "test-v1",
    trustedKeyBlock: { ...target, seqno: 100 },
    targetBlock: { ...target },
    targetGeneratedAtUnix: 1_800_000_200,
    observedAtUnix: 1_800_000_210,
    linkCount: 1,
    latestKeyBlock: null,
    rawProofHash: "3".repeat(64),
    checkpointEvidenceHash: "4".repeat(64),
    links: [],
  };
}

function header(state: Cell, target = blockId()): TonProvenMasterchainHeader {
  return {
    kind: "TON_PROVEN_MASTERCHAIN_HEADER",
    rootHashVerified: true,
    fileHashVerified: false,
    signaturesVerified: false,
    finalityProven: false,
    globalId: GLOBAL_ID,
    block: { ...target },
    version: 0,
    verticalSeqno: 0,
    generatedAtUnix: 1_800_000_200,
    startLt: "1000",
    endLt: "2000",
    keyBlock: false,
    validatorListHashShort: 1,
    catchainSeqno: 1,
    minReferencedMasterchainSeqno: 100,
    previousKeyBlockSeqno: 100,
    previousBlock: { ...target, seqno: 114, endLt: "900" },
    previousVerticalBlock: null,
    software: null,
    oldStateHash: "5".repeat(64),
    newStateHash: state.hash(0).toString("hex"),
  };
}

function proof(state: Cell): Buffer {
  return convertToMerkleProof(state).toBoc({ idx: false, crc32: false });
}

const limits = { maxBocBytes: 250_000, maxCells: 10_000, maxDepth: 256 };

describe("TON finalized shard-descriptor proof", () => {
  it("binds the exact basechain shard descriptor to the finalized state hash", () => {
    const state = masterchainState();
    expect(
      verifyTonShardDescriptorProof(chain(), header(state), proof(state), {
        workchain: 0,
        shard: MC_SHARD,
        limits,
      }),
    ).toMatchObject({
      kind: "TON_PROVEN_SHARD_DESCRIPTOR",
      masterchainFinalityProven: true,
      masterchainStateProofVerified: true,
      shardDictionaryInclusionVerified: true,
      shardPrefixVerified: true,
      shardDescriptorFinalityProven: true,
      shardBlockProofVerified: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      workchain: 0,
      shard: MC_SHARD,
      shardPrefixBits: 0,
      block: {
        seqno: 77,
        rootHash: "a".repeat(64),
        fileHash: "b".repeat(64),
      },
      registeredAtMasterchainSeqno: 115,
      startLt: "10000",
      endLt: "20000",
      nextCatchainSeqno: 9,
      nextValidatorShard: MC_SHARD,
      minimumReferencedMasterchainSeqno: 100,
      futureSplitMerge: { kind: "none" },
    });
  });

  it("selects exact left and right child prefixes in a split tree", () => {
    const tree = fork(
      leaf(descriptor({ seqno: 70, rootHash: "c".repeat(64) })),
      leaf(descriptor({ seqno: 80, rootHash: "d".repeat(64) })),
    );
    const state = masterchainState({ tree });
    const left = verifyTonShardDescriptorProof(
      chain(),
      header(state),
      proof(state),
      { workchain: 0, shard: LEFT_SHARD, limits },
    );
    const right = verifyTonShardDescriptorProof(
      chain(),
      header(state),
      proof(state),
      { workchain: 0, shard: RIGHT_SHARD, limits },
    );
    expect(left).toMatchObject({
      shardPrefixBits: 1,
      block: { seqno: 70, rootHash: "c".repeat(64) },
    });
    expect(right).toMatchObject({
      shardPrefixBits: 1,
      block: { seqno: 80, rootHash: "d".repeat(64) },
    });
  });

  it("parses the new descriptor layout and split/merge scheduling", () => {
    const state = masterchainState({
      tree: leaf(descriptor({ tag: 0xa, future: "merge" })),
    });
    expect(
      verifyTonShardDescriptorProof(chain(), header(state), proof(state), {
        workchain: 0,
        shard: MC_SHARD,
        limits,
      }).futureSplitMerge,
    ).toEqual({
      kind: "merge",
      atUnix: 1_800_000_300,
      intervalSeconds: 60,
    });
  });

  it("rejects a state proof not committed by the finalized block", () => {
    const state = masterchainState();
    const other = masterchainState({ seqno: 114 });
    expect(() =>
      verifyTonShardDescriptorProof(chain(), header(state), proof(other), {
        workchain: 0,
        shard: MC_SHARD,
        limits,
      }),
    ).toThrow("state-update hash");
  });

  it("rejects finalized-chain/header and state metadata disagreement", () => {
    const state = masterchainState();
    const mismatchedHeader = header(state, {
      ...blockId(),
      fileHash: "f".repeat(64),
    });
    expect(() =>
      verifyTonShardDescriptorProof(chain(), mismatchedHeader, proof(state), {
        workchain: 0,
        shard: MC_SHARD,
        limits,
      }),
    ).toThrow("finalized target");
    const wrongState = masterchainState({ seqno: 114 });
    expect(() =>
      verifyTonShardDescriptorProof(
        chain(),
        header(wrongState),
        proof(wrongState),
        { workchain: 0, shard: MC_SHARD, limits },
      ),
    ).toThrow("block metadata");
  });

  it("rejects non-exact shard prefixes and a pruned target branch", () => {
    const left = leaf(descriptor());
    const right = leaf(descriptor({ seqno: 78 }));
    const splitState = masterchainState({ tree: fork(left, right) });
    expect(() =>
      verifyTonShardDescriptorProof(
        chain(),
        header(splitState),
        proof(splitState),
        { workchain: 0, shard: MC_SHARD, limits },
      ),
    ).toThrow("forks below");

    const prunedState = masterchainState({ tree: fork(pruned(left), right) });
    expect(() =>
      verifyTonShardDescriptorProof(
        chain(),
        header(prunedState),
        proof(prunedState),
        { workchain: 0, shard: LEFT_SHARD, limits },
      ),
    ).toThrow("hidden by pruning");
  });

  it("rejects malformed shard and descriptor metadata", () => {
    const state = masterchainState();
    expect(() =>
      verifyTonShardDescriptorProof(chain(), header(state), proof(state), {
        workchain: 0,
        shard: "0",
        limits,
      }),
    ).toThrow("zero");
    for (const mutation of [
      { flags: 1 },
      { rootHash: "0".repeat(64) },
      { registeredAtMasterchainSeqno: 116 },
      { minimumReferencedMasterchainSeqno: 116 },
    ]) {
      const invalid = masterchainState({ tree: leaf(descriptor(mutation)) });
      expect(() =>
        verifyTonShardDescriptorProof(
          chain(),
          header(invalid),
          proof(invalid),
          { workchain: 0, shard: MC_SHARD, limits },
        ),
      ).toThrow();
    }
  });

  it("uses a dedicated error for invalid masterchain provenance", () => {
    const state = masterchainState();
    const invalid = chain();
    invalid.authorizationAllowed = true as false;
    expect(() =>
      verifyTonShardDescriptorProof(invalid, header(state), proof(state), {
        workchain: 0,
        shard: MC_SHARD,
        limits,
      }),
    ).toThrow(TonShardDescriptorProofError);
  });
});
