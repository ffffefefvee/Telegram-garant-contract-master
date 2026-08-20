import {
  beginCell,
  Cell,
  convertToMerkleProof,
  storeShardIdent,
} from "@ton/core";
import type { TonProvenShardDescriptor } from "./ton-shard-descriptor-proof";
import {
  TonShardBlockProofError,
  verifyTonShardBlockProof,
} from "./ton-shard-block-proof";

const GLOBAL_ID = -3;
const MC_SHARD = "-9223372036854775808";
const FULL_SHARD = MC_SHARD;
const LEFT_SHARD = "4611686018427387904";
const RIGHT_SHARD = "-4611686018427387904";
const limits = { maxBocBytes: 250_000, maxCells: 10_000, maxDepth: 256 };

interface BlockOptions {
  shard?: string;
  shardPrefixBits?: number;
  seqno?: number;
  previousSeqnos?: [number] | [number, number];
  afterMerge?: boolean;
  beforeSplit?: boolean;
  afterSplit?: boolean;
  wantSplit?: boolean;
  wantMerge?: boolean;
  globalId?: number;
  workchain?: number;
  generatedAtUnix?: number;
  startLt?: bigint;
  endLt?: bigint;
  stateUpdate?: Cell;
}

function extBlockRef(seqno: number, marker: number): Cell {
  return beginCell()
    .storeUint(900n + BigInt(marker), 64)
    .storeUint(seqno, 32)
    .storeBuffer(Buffer.alloc(32, marker))
    .storeBuffer(Buffer.alloc(32, marker + 10))
    .endCell();
}

function merkleUpdate(): Cell {
  const oldState = beginCell().storeUint(1, 8).endCell();
  const newState = beginCell().storeUint(2, 8).endCell();
  return beginCell()
    .storeUint(4, 8)
    .storeBuffer(oldState.hash(0))
    .storeBuffer(newState.hash(0))
    .storeUint(oldState.depth(0), 16)
    .storeUint(newState.depth(0), 16)
    .storeRef(oldState)
    .storeRef(newState)
    .endCell({ exotic: true });
}

function rawShard(value: string): bigint {
  return BigInt.asUintN(64, BigInt(value));
}

function shardBlock(options: BlockOptions = {}): Cell {
  const seqno = options.seqno ?? 77;
  const afterMerge = options.afterMerge ?? false;
  const previousSeqnos =
    options.previousSeqnos ?? (afterMerge ? [76, 75] : [76]);
  const previous = afterMerge
    ? beginCell()
        .storeRef(extBlockRef(previousSeqnos[0], 3))
        .storeRef(extBlockRef(previousSeqnos[1]!, 4))
        .endCell()
    : extBlockRef(previousSeqnos[0], 3);
  const info = beginCell()
    .storeUint(0x9bc7a987, 32)
    .storeUint(0, 32)
    .storeBit(true)
    .storeBit(afterMerge)
    .storeBit(options.beforeSplit ?? false)
    .storeBit(options.afterSplit ?? false)
    .storeBit(options.wantSplit ?? false)
    .storeBit(options.wantMerge ?? false)
    .storeBit(false)
    .storeBit(false)
    .storeUint(0, 8)
    .storeUint(seqno, 32)
    .storeUint(0, 32)
    .store(
      storeShardIdent({
        shardPrefixBits: options.shardPrefixBits ?? 0,
        workchainId: options.workchain ?? 0,
        shardPrefix: rawShard(options.shard ?? FULL_SHARD),
      }),
    )
    .storeUint(options.generatedAtUnix ?? 1_800_000_190, 32)
    .storeUint(options.startLt ?? 10_000n, 64)
    .storeUint(options.endLt ?? 20_000n, 64)
    .storeUint(0x11223344, 32)
    .storeUint(9, 32)
    .storeUint(100, 32)
    .storeUint(0, 32)
    .storeRef(extBlockRef(114, 8))
    .storeRef(previous)
    .endCell();
  const dummy = beginCell().storeBit(false).endCell();
  return beginCell()
    .storeUint(0x11ef55aa, 32)
    .storeInt(options.globalId ?? GLOBAL_ID, 32)
    .storeRef(info)
    .storeRef(dummy)
    .storeRef(options.stateUpdate ?? merkleUpdate())
    .storeRef(dummy)
    .endCell();
}

function descriptor(
  block: Cell,
  options: BlockOptions = {},
): TonProvenShardDescriptor {
  const shard = options.shard ?? FULL_SHARD;
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
    masterchainBlock: {
      workchain: -1,
      shard: MC_SHARD,
      seqno: 115,
      rootHash: "1".repeat(64),
      fileHash: "2".repeat(64),
    },
    masterchainStateHash: "3".repeat(64),
    masterchainStateProofRootHash: "4".repeat(64),
    networkGlobalId: GLOBAL_ID,
    workchain: 0,
    shard,
    shardPrefixBits: options.shardPrefixBits ?? 0,
    block: {
      workchain: 0,
      shard,
      seqno: options.seqno ?? 77,
      rootHash: block.hash(0).toString("hex"),
      fileHash: "5".repeat(64),
    },
    registeredAtMasterchainSeqno: 115,
    startLt: (options.startLt ?? 10_000n).toString(),
    endLt: (options.endLt ?? 20_000n).toString(),
    beforeSplit: options.beforeSplit ?? false,
    beforeMerge: false,
    wantSplit: options.wantSplit ?? false,
    wantMerge: options.wantMerge ?? false,
    nextCatchainUpdated: false,
    nextCatchainSeqno: 9,
    nextValidatorShard: shard,
    minimumReferencedMasterchainSeqno: 100,
    generatedAtUnix: options.generatedAtUnix ?? 1_800_000_190,
    futureSplitMerge: { kind: "none" },
  };
}

function proof(block: Cell): Buffer {
  return convertToMerkleProof(block).toBoc({ idx: false, crc32: false });
}

describe("TON finalized shard-block header proof", () => {
  it("binds an ordinary shard block and its state update to the finalized descriptor", () => {
    const block = shardBlock();
    const result = verifyTonShardBlockProof(descriptor(block), proof(block), {
      limits,
    });
    expect(result).toMatchObject({
      kind: "TON_PROVEN_SHARD_BLOCK_HEADER",
      shardDescriptorFinalityProven: true,
      shardBlockProofVerified: true,
      shardBlockFinalityProven: true,
      shardStateProofVerified: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      block: { workchain: 0, shard: FULL_SHARD, seqno: 77 },
      afterMerge: false,
      afterSplit: false,
      previousBlocks: [{ workchain: 0, shard: FULL_SHARD, seqno: 76 }],
      masterchainReference: {
        workchain: -1,
        shard: MC_SHARD,
        seqno: 114,
      },
    });
    expect(result.oldStateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.newStateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("infers the parent predecessor of an after-split block", () => {
    const options: BlockOptions = {
      shard: LEFT_SHARD,
      shardPrefixBits: 1,
      afterSplit: true,
    };
    const block = shardBlock(options);
    expect(
      verifyTonShardBlockProof(descriptor(block, options), proof(block), {
        limits,
      }).previousBlocks,
    ).toMatchObject([{ shard: FULL_SHARD, seqno: 76 }]);
  });

  it("infers both child predecessors of an after-merge block", () => {
    const options: BlockOptions = { afterMerge: true };
    const block = shardBlock(options);
    expect(
      verifyTonShardBlockProof(descriptor(block, options), proof(block), {
        limits,
      }).previousBlocks,
    ).toMatchObject([
      { shard: LEFT_SHARD, seqno: 76 },
      { shard: RIGHT_SHARD, seqno: 75 },
    ]);
  });

  it("rejects a block proof not bound by the descriptor root", () => {
    const block = shardBlock();
    const other = shardBlock({ seqno: 78, previousSeqnos: [77] });
    expect(() =>
      verifyTonShardBlockProof(descriptor(block), proof(other), { limits }),
    ).toThrow("descriptor root");
  });

  it.each([
    ["network", { globalId: -239 }, "global_id"],
    ["workchain", { workchain: -1 }, "identity"],
    ["shard", { shard: LEFT_SHARD, shardPrefixBits: 1 }, "identity"],
    ["time", { generatedAtUnix: 1_800_000_191 }, "metadata"],
    ["logical time", { endLt: 20_001n }, "metadata"],
  ] as const)(
    "rejects %s drift from the finalized descriptor",
    (_label, mutation, message) => {
      const mutated = shardBlock(mutation);
      expect(() =>
        verifyTonShardBlockProof(descriptor(mutated), proof(mutated), {
          limits,
        }),
      ).toThrow(message);
    },
  );

  it("rejects invalid split/merge predecessor relationships", () => {
    const simultaneous: BlockOptions = { afterMerge: true, afterSplit: true };
    const simultaneousBlock = shardBlock(simultaneous);
    expect(() =>
      verifyTonShardBlockProof(
        descriptor(simultaneousBlock, simultaneous),
        proof(simultaneousBlock),
        { limits },
      ),
    ).toThrow("after merge and split");

    const wrongSequence: BlockOptions = { previousSeqnos: [75] };
    const wrongSequenceBlock = shardBlock(wrongSequence);
    expect(() =>
      verifyTonShardBlockProof(
        descriptor(wrongSequenceBlock, wrongSequence),
        proof(wrongSequenceBlock),
        { limits },
      ),
    ).toThrow("does not follow");
  });

  it("rejects a non-Merkle state update", () => {
    const options = {
      stateUpdate: beginCell().storeUint(4, 8).endCell(),
    };
    const block = shardBlock(options);
    expect(() =>
      verifyTonShardBlockProof(descriptor(block, options), proof(block), {
        limits,
      }),
    ).toThrow("MerkleUpdate");
  });

  it("uses a dedicated error for invalid descriptor provenance", () => {
    const block = shardBlock();
    const invalid = descriptor(block);
    invalid.authorizationAllowed = true as false;
    expect(() =>
      verifyTonShardBlockProof(invalid, proof(block), { limits }),
    ).toThrow(TonShardBlockProofError);
  });
});
