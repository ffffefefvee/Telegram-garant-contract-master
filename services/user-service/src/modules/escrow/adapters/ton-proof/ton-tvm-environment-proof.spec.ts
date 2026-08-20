import {
  beginCell,
  Cell,
  convertToMerkleProof,
  storeCurrencyCollection,
  storeShardIdent,
} from "@ton/core";
import { defaultConfig } from "@ton/sandbox";
import type { TonProvenMasterchainCheckpointChain } from "./ton-checkpoint-chain";
import type { TonProvenMasterchainHeader } from "./ton-masterchain-header-proof";
import {
  TonTvmEnvironmentProofError,
  verifyTonTvmEnvironmentProof,
} from "./ton-tvm-environment-proof";

const GLOBAL_ID = -3;
const MASTERCHAIN_SHARD = "-9223372036854775808";
const configurationRoot = Cell.fromBase64(defaultConfig);
const limits = { maxBocBytes: 500_000, maxCells: 5_000, maxDepth: 512 };

function block(rootHash: string) {
  return {
    workchain: -1,
    shard: MASTERCHAIN_SHARD,
    seqno: 120,
    rootHash,
    fileHash: "22".repeat(32),
  };
}

function prunedBranch(cell: Cell): Cell {
  return beginCell()
    .storeUint(1, 8)
    .storeUint(1, 8)
    .storeBuffer(cell.hash(0))
    .storeUint(cell.depth(0), 16)
    .endCell({ exotic: true });
}

interface FixtureOptions {
  globalId?: number;
  seqno?: number;
  verticalSeqno?: number;
  generatedAtUnix?: number;
  generatedLt?: bigint;
  minimumReferencedSeqno?: number;
  beforeSplit?: boolean;
  configurationAddress?: Buffer;
  config?: Cell;
}

function fixture(options: FixtureOptions = {}) {
  const dummy = beginCell().storeBit(false).endCell();
  const extra = beginCell()
    .storeUint(0xcc26, 16)
    .storeBit(false)
    .storeBuffer(options.configurationAddress ?? Buffer.alloc(32, 0x33))
    .storeRef(options.config ?? configurationRoot)
    .storeRef(dummy)
    .store(storeCurrencyCollection({ coins: 0n }))
    .endCell();
  const state = beginCell()
    .storeUint(0x9023afe2, 32)
    .storeInt(options.globalId ?? GLOBAL_ID, 32)
    .store(
      storeShardIdent({
        shardPrefixBits: 0,
        workchainId: -1,
        shardPrefix: 1n << 63n,
      }),
    )
    .storeUint(options.seqno ?? 120, 32)
    .storeUint(options.verticalSeqno ?? 0, 32)
    .storeUint(options.generatedAtUnix ?? 1_800_000_200, 32)
    .storeUint(options.generatedLt ?? 30_000n, 64)
    .storeUint(options.minimumReferencedSeqno ?? 110, 32)
    .storeRef(dummy)
    .storeBit(options.beforeSplit ?? false)
    .storeRef(dummy)
    .storeRef(dummy)
    .storeBit(true)
    .storeRef(extra)
    .endCell();
  const target = block("11".repeat(32));
  const header: TonProvenMasterchainHeader = {
    kind: "TON_PROVEN_MASTERCHAIN_HEADER",
    rootHashVerified: true,
    fileHashVerified: false,
    signaturesVerified: false,
    finalityProven: false,
    globalId: GLOBAL_ID,
    block: target,
    version: 0,
    verticalSeqno: 0,
    generatedAtUnix: 1_800_000_200,
    startLt: "20000",
    endLt: "30000",
    keyBlock: false,
    validatorListHashShort: 1,
    catchainSeqno: 2,
    minReferencedMasterchainSeqno: 110,
    previousKeyBlockSeqno: 100,
    previousBlock: { ...block("44".repeat(32)), seqno: 119, endLt: "19999" },
    previousVerticalBlock: null,
    software: null,
    oldStateHash: "55".repeat(32),
    newStateHash: state.hash(0).toString("hex"),
  };
  const chain: TonProvenMasterchainCheckpointChain = {
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
    trustedKeyBlock: { ...block("66".repeat(32)), seqno: 100 },
    targetBlock: { ...target },
    targetGeneratedAtUnix: 1_800_000_200,
    observedAtUnix: 1_800_000_205,
    linkCount: 1,
    latestKeyBlock: null,
    rawProofHash: "77".repeat(32),
    checkpointEvidenceHash: "88".repeat(32),
    links: [],
  };
  return {
    chain,
    header,
    state,
    proof: convertToMerkleProof(state).toBoc({ idx: false, crc32: false }),
  };
}

describe("TON proven TVM environment", () => {
  it("authenticates a complete configuration dictionary at the finalized anchor", () => {
    const input = fixture();
    const result = verifyTonTvmEnvironmentProof(
      input.chain,
      input.header,
      input.proof,
      { limits },
    );
    expect(result).toMatchObject({
      kind: "TON_PROVEN_TVM_ENVIRONMENT",
      masterchainFinalityProven: true,
      masterchainStateProofVerified: true,
      configurationDictionaryProofVerified: true,
      configurationComplete: true,
      localGetterExecutionVerified: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      networkGlobalId: GLOBAL_ID,
      generatedAtUnix: 1_800_000_200,
      generatedLt: "30000",
      configurationAddress: "33".repeat(32),
      configurationRootHash: configurationRoot.hash(0).toString("hex"),
    });
  });

  it("rejects a state proof detached from the finalized header", () => {
    const input = fixture();
    input.header.newStateHash = "99".repeat(32);
    expect(() =>
      verifyTonTvmEnvironmentProof(input.chain, input.header, input.proof, {
        limits,
      }),
    ).toThrow("state update");
  });

  it.each([
    ["network", { globalId: -239 }],
    ["sequence", { seqno: 121 }],
    ["vertical sequence", { verticalSeqno: 1 }],
    ["generation time", { generatedAtUnix: 1_800_000_201 }],
    ["logical time", { generatedLt: 30_001n }],
    ["minimum reference", { minimumReferencedSeqno: 111 }],
    ["split state", { beforeSplit: true }],
  ] as const)("rejects masterchain state %s drift", (_label, mutation) => {
    const input = fixture(mutation);
    expect(() =>
      verifyTonTvmEnvironmentProof(input.chain, input.header, input.proof, {
        limits,
      }),
    ).toThrow("state identity");
  });

  it("rejects a configuration subtree hidden by pruning", () => {
    const input = fixture({ config: prunedBranch(configurationRoot) });
    expect(() =>
      verifyTonTvmEnvironmentProof(input.chain, input.header, input.proof, {
        limits,
      }),
    ).toThrow("pruned branch");
  });

  it("rejects a zero configuration address", () => {
    const input = fixture({ configurationAddress: Buffer.alloc(32) });
    expect(() =>
      verifyTonTvmEnvironmentProof(input.chain, input.header, input.proof, {
        limits,
      }),
    ).toThrow("address is zero");
  });

  it("rejects a finalized checkpoint target substituted after verification", () => {
    const input = fixture();
    input.chain.targetBlock = { ...input.chain.targetBlock, seqno: 121 };
    expect(() =>
      verifyTonTvmEnvironmentProof(input.chain, input.header, input.proof, {
        limits,
      }),
    ).toThrow("finalized checkpoint target");
  });

  it("uses a dedicated error for forged checkpoint provenance", () => {
    const input = fixture();
    input.chain.authorizationAllowed = true as false;
    expect(() =>
      verifyTonTvmEnvironmentProof(input.chain, input.header, input.proof, {
        limits,
      }),
    ).toThrow(TonTvmEnvironmentProofError);
  });

  it("enforces the shared proof resource budget", () => {
    const input = fixture();
    expect(() =>
      verifyTonTvmEnvironmentProof(input.chain, input.header, input.proof, {
        limits: { ...limits, maxCells: 10 },
      }),
    ).toThrow("cell count");
  });
});
