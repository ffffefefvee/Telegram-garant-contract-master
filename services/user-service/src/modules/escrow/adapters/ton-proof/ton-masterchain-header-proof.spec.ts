import {
  beginCell,
  Cell,
  convertToMerkleProof,
  storeShardIdent,
} from "@ton/core";
import {
  TonMasterchainHeaderExpectation,
  TonMasterchainHeaderProofError,
  verifyTonMasterchainHeaderCell,
} from "./ton-masterchain-header-proof";

const MC_SHARD = "-9223372036854775808";
const GLOBAL_ID = -3;

interface FixtureOverrides {
  globalId?: number;
  seqno?: number;
  previousSeqno?: number;
  previousKeyBlockSeqno?: number;
  workchain?: number;
  shardPrefixBits?: number;
  shardPrefix?: bigint;
  version?: number;
  flags?: number;
  splitFlag?: boolean;
  notMaster?: boolean;
  stateUpdate?: Cell;
}

function extBlockRef(seqno: number, digit: string): Cell {
  return beginCell()
    .storeUint(900n, 64)
    .storeUint(seqno, 32)
    .storeBuffer(Buffer.from(digit.repeat(64), "hex"))
    .storeBuffer(Buffer.from((digit === "a" ? "b" : "a").repeat(64), "hex"))
    .endCell();
}

function merkleUpdate(): Cell {
  const oldState = beginCell().storeUint(1, 8).endCell();
  const newState = beginCell().storeUint(2, 8).endCell();
  return beginCell()
    .storeUint(4, 8)
    .storeBuffer(oldState.hash())
    .storeBuffer(newState.hash())
    .storeUint(oldState.depth(), 16)
    .storeUint(newState.depth(), 16)
    .storeRef(oldState)
    .storeRef(newState)
    .endCell({ exotic: true });
}

function fixture(overrides: FixtureOverrides = {}) {
  const seqno = overrides.seqno ?? 101;
  const flags = overrides.flags ?? 1;
  const info = beginCell()
    .storeUint(0x9bc7a987, 32)
    .storeUint(overrides.version ?? 0, 32)
    .storeBit(overrides.notMaster ?? false)
    .storeBit(false)
    .storeBit(overrides.splitFlag ?? false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeUint(flags, 8)
    .storeUint(seqno, 32)
    .storeUint(0, 32)
    .store(
      storeShardIdent({
        shardPrefixBits: overrides.shardPrefixBits ?? 0,
        workchainId: overrides.workchain ?? -1,
        shardPrefix: overrides.shardPrefix ?? 1n << 63n,
      }),
    )
    .storeUint(1_800_000_000, 32)
    .storeUint(1_000n, 64)
    .storeUint(2_000n, 64)
    .storeUint(0x11223344, 32)
    .storeUint(7, 32)
    .storeUint(100, 32)
    .storeUint(overrides.previousKeyBlockSeqno ?? 100, 32);
  if ((flags & 1) !== 0) {
    info.storeUint(0xc4, 8).storeUint(9, 32).storeUint(123n, 64);
  }
  info.storeRef(extBlockRef(overrides.previousSeqno ?? seqno - 1, "a"));

  const block = beginCell()
    .storeUint(0x11ef55aa, 32)
    .storeInt(overrides.globalId ?? GLOBAL_ID, 32)
    .storeRef(info.endCell())
    .storeRef(beginCell().storeUint(0, 1).endCell())
    .storeRef(overrides.stateUpdate ?? merkleUpdate())
    .storeRef(beginCell().storeUint(0, 1).endCell())
    .endCell();
  const proof = convertToMerkleProof(block);
  const expectation: TonMasterchainHeaderExpectation = {
    globalId: GLOBAL_ID,
    trustedKeyBlockSeqno: 100,
    targetBlock: {
      workchain: -1,
      shard: MC_SHARD,
      seqno: 101,
      rootHash: block.hash().toString("hex"),
      fileHash: "f".repeat(64),
    },
  };
  return { block, proof, expectation };
}

describe("TON masterchain header Merkle proof", () => {
  it("returns a typed proven header bound to the target root and trusted key block", () => {
    const { proof, expectation } = fixture();
    const result = verifyTonMasterchainHeaderCell(proof.refs[0], expectation);
    expect(result).toMatchObject({
      kind: "TON_PROVEN_MASTERCHAIN_HEADER",
      rootHashVerified: true,
      fileHashVerified: false,
      signaturesVerified: false,
      finalityProven: false,
      globalId: GLOBAL_ID,
      version: 0,
      verticalSeqno: 0,
      generatedAtUnix: 1_800_000_000,
      startLt: "1000",
      endLt: "2000",
      keyBlock: false,
      validatorListHashShort: 0x11223344,
      catchainSeqno: 7,
      minReferencedMasterchainSeqno: 100,
      previousKeyBlockSeqno: 100,
      previousBlock: { seqno: 100, endLt: "900" },
      software: { version: 9, capabilities: "123" },
    });
    expect(result.oldStateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.newStateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a header without optional GlobalVersion", () => {
    const { proof, expectation } = fixture({ flags: 0 });
    expect(
      verifyTonMasterchainHeaderCell(proof.refs[0], expectation).software,
    ).toBeNull();
  });

  it.each([
    ["global ID", { globalId: -239 }, "global_id"],
    ["sequence", { seqno: 102 }, "seqno"],
    ["previous sequence", { previousSeqno: 99 }, "predecessor"],
    ["key anchor", { previousKeyBlockSeqno: 99 }, "trusted anchor"],
    ["workchain", { workchain: 0 }, "masterchain"],
    ["prefix bits", { shardPrefixBits: 1 }, "masterchain"],
    ["prefix", { shardPrefix: 0n }, "masterchain"],
    ["version", { version: 1 }, "version"],
    ["flags", { flags: 2 }, "flags"],
    ["split flag", { splitFlag: true }, "split/merge"],
    ["not-master flag", { notMaster: true }, "non-master"],
  ] as const)(
    "rejects a header with wrong %s",
    (_label, overrides, message) => {
      const { proof, expectation } = fixture(overrides);
      expect(() =>
        verifyTonMasterchainHeaderCell(proof.refs[0], expectation),
      ).toThrow(message);
    },
  );

  it("rejects a target root-hash substitution", () => {
    const { proof, expectation } = fixture();
    expectation.targetBlock.rootHash = "e".repeat(64);
    expect(() =>
      verifyTonMasterchainHeaderCell(proof.refs[0], expectation),
    ).toThrow("rootHash");
  });

  it("rejects an ordinary state update", () => {
    const { proof, expectation } = fixture({
      stateUpdate: beginCell().storeUint(4, 8).endCell(),
    });
    expect(() =>
      verifyTonMasterchainHeaderCell(proof.refs[0], expectation),
    ).toThrow("MerkleUpdate");
  });

  it("rejects a non-Block virtual root", () => {
    const cell = beginCell().storeUint(0, 64).endCell();
    const { expectation } = fixture();
    expectation.targetBlock.rootHash = cell.hash().toString("hex");
    expect(() => verifyTonMasterchainHeaderCell(cell, expectation)).toThrow(
      "TON Block",
    );
  });

  it("uses a dedicated proof error type", () => {
    const { proof, expectation } = fixture();
    expectation.globalId = Number.NaN;
    expect(() =>
      verifyTonMasterchainHeaderCell(proof.refs[0], expectation),
    ).toThrow(TonMasterchainHeaderProofError);
  });
});
