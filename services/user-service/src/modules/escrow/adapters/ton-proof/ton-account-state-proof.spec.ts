import {
  Account,
  Address,
  beginCell,
  Cell,
  convertToMerkleProof,
  storeAccount,
  storeDepthBalanceInfo,
  storeShardIdent,
} from "@ton/core";
import {
  TonAccountStateProofError,
  verifyTonAccountStateProof,
} from "./ton-account-state-proof";
import type { TonProvenShardBlockHeader } from "./ton-shard-block-proof";
import { serializeBocRoots } from "./ton-proof-test-utils";

const GLOBAL_ID = -3;
const FULL_SHARD = "-9223372036854775808";
const LEFT_SHARD = "4611686018427387904";
const RIGHT_SHARD = "-4611686018427387904";
const accountAddress = Address.parseRaw(`0:${"11".repeat(32)}`);
const otherAddress = Address.parseRaw(`0:${"ee".repeat(32)}`);
const code = beginCell().storeUint(0xcafe, 16).endCell();
const data = beginCell().storeUint(0xbeef, 16).endCell();
const limits = { maxBocBytes: 250_000, maxCells: 10_000, maxDepth: 256 };

interface FixtureOptions {
  globalId?: number;
  workchain?: number;
  shard?: string;
  blockShard?: string;
  shardPrefixBits?: number;
  seqno?: number;
  verticalSeqno?: number;
  generatedAtUnix?: number;
  generatedLt?: bigint;
  minimumReferencedMasterchainSeqno?: number;
  beforeSplit?: boolean;
  dictionaryAddress?: Address;
  accountAddress?: Address;
  dictionaryLastTransactionLt?: bigint;
  accountLastTransactionLt?: bigint;
  accountState?: "active" | "uninit";
  includeCode?: boolean;
  includeData?: boolean;
  separateAccountRoot?: Cell;
  pruneDictionaryRoot?: boolean;
  forkedDictionary?: boolean;
  pruneUnrelatedSibling?: boolean;
}

function signedShard(value: string): bigint {
  return BigInt.asUintN(64, BigInt(value));
}

function depthBalance() {
  return storeDepthBalanceInfo({
    splitDepth: 0,
    balance: { coins: 1_000_000_000n },
  });
}

function activeAccountRoot(options: FixtureOptions): Cell {
  const address = options.accountAddress ?? accountAddress;
  const lastTransLt = options.accountLastTransactionLt ?? 700n;
  const state =
    options.accountState === "uninit"
      ? ({ type: "uninit" } as const)
      : ({
          type: "active",
          state: {
            code: options.includeCode === false ? undefined : code,
            data: options.includeData === false ? undefined : data,
          },
        } as const);
  const account: Account = {
    addr: address,
    storageStats: {
      used: { cells: 2n, bits: 512n },
      storageExtra: null,
      lastPaid: 1_800_000_000,
    },
    storage: {
      lastTransLt,
      balance: { coins: 2_000_000_000n },
      state,
    },
  };
  return beginCell().storeBit(true).store(storeAccount(account)).endCell();
}

function dictionaryLeaf(
  dictionaryAddress: Address,
  accountRoot: Cell,
  lastTransactionLt: bigint,
  keyOffset: number,
): Cell {
  const remaining = 256 - keyOffset;
  const lengthBits = Math.ceil(Math.log2(remaining + 1));
  const key =
    BigInt(`0x${dictionaryAddress.hash.toString("hex")}`) &
    ((1n << BigInt(remaining)) - 1n);
  return beginCell()
    .storeBit(true)
    .storeBit(false)
    .storeUint(remaining, lengthBits)
    .storeUint(key, remaining)
    .store(depthBalance())
    .storeRef(accountRoot)
    .storeUint(BigInt(`0x${"55".repeat(32)}`), 256)
    .storeUint(lastTransactionLt, 64)
    .endCell();
}

function prunedBranch(cell: Cell): Cell {
  return beginCell()
    .storeUint(1, 8)
    .storeUint(1, 8)
    .storeBuffer(cell.hash(0))
    .storeUint(cell.depth(0), 16)
    .endCell({ exotic: true });
}

function shardAccounts(
  dictionaryAddress: Address,
  accountRoot: Cell,
  lastTransactionLt: bigint,
  options: Pick<
    FixtureOptions,
    "pruneDictionaryRoot" | "forkedDictionary" | "pruneUnrelatedSibling"
  >,
): Cell {
  const edge = dictionaryLeaf(
    dictionaryAddress,
    accountRoot,
    lastTransactionLt,
    0,
  );
  let root = edge;
  if (options.forkedDictionary) {
    const left = dictionaryLeaf(
      dictionaryAddress,
      accountRoot,
      lastTransactionLt,
      1,
    );
    const otherRoot = activeAccountRoot({ accountAddress: otherAddress });
    const completeRight = dictionaryLeaf(otherAddress, otherRoot, 800n, 1);
    const right = options.pruneUnrelatedSibling
      ? prunedBranch(completeRight)
      : completeRight;
    root = beginCell()
      .storeBit(false)
      .storeBit(false)
      .storeRef(left)
      .storeRef(right)
      .store(depthBalance())
      .endCell();
  }
  if (options.pruneDictionaryRoot) root = prunedBranch(root);
  return beginCell()
    .storeBit(true)
    .storeRef(root)
    .store(depthBalance())
    .endCell();
}

function fixture(options: FixtureOptions = {}) {
  const shard = options.shard ?? FULL_SHARD;
  const blockShard = options.blockShard ?? FULL_SHARD;
  const prefixBits = options.shardPrefixBits ?? (shard === FULL_SHARD ? 0 : 1);
  const seqno = options.seqno ?? 77;
  const verticalSeqno = options.verticalSeqno ?? 0;
  const generatedAtUnix = options.generatedAtUnix ?? 1_800_000_190;
  const generatedLt = options.generatedLt ?? 20_000n;
  const minimumReferencedMasterchainSeqno =
    options.minimumReferencedMasterchainSeqno ?? 100;
  const beforeSplit = options.beforeSplit ?? false;
  const dictionaryLastTransactionLt =
    options.dictionaryLastTransactionLt ?? 700n;
  const dictionaryAccountRoot = activeAccountRoot(options);
  const accounts = shardAccounts(
    options.dictionaryAddress ?? accountAddress,
    dictionaryAccountRoot,
    dictionaryLastTransactionLt,
    options,
  );
  const dummy = beginCell().storeBit(false).endCell();
  const stateRoot = beginCell()
    .storeUint(0x9023afe2, 32)
    .storeInt(options.globalId ?? GLOBAL_ID, 32)
    .store(
      storeShardIdent({
        shardPrefixBits: prefixBits,
        workchainId: options.workchain ?? 0,
        shardPrefix: signedShard(shard),
      }),
    )
    .storeUint(seqno, 32)
    .storeUint(verticalSeqno, 32)
    .storeUint(generatedAtUnix, 32)
    .storeUint(generatedLt, 64)
    .storeUint(minimumReferencedMasterchainSeqno, 32)
    .storeRef(dummy)
    .storeBit(beforeSplit)
    .storeRef(accounts)
    .storeRef(dummy)
    .storeBit(false)
    .endCell();
  const blockRoot = beginCell()
    .storeUint(0x11ef55aa, 32)
    .storeRef(dummy)
    .endCell();
  const block: TonProvenShardBlockHeader = {
    kind: "TON_PROVEN_SHARD_BLOCK_HEADER",
    shardDescriptorFinalityProven: true,
    shardBlockProofVerified: true,
    shardBlockFinalityProven: true,
    shardStateProofVerified: false,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: GLOBAL_ID,
    finalizedByMasterchainBlock: {
      workchain: -1,
      shard: FULL_SHARD,
      seqno: 120,
      rootHash: "a".repeat(64),
      fileHash: "b".repeat(64),
    },
    block: {
      workchain: 0,
      shard: blockShard,
      seqno: 77,
      rootHash: blockRoot.hash(0).toString("hex"),
      fileHash: "5".repeat(64),
    },
    version: 0,
    verticalSeqno: 0,
    generatedAtUnix: 1_800_000_190,
    startLt: "10000",
    endLt: "20000",
    afterMerge: false,
    beforeSplit: false,
    afterSplit: false,
    wantSplit: false,
    wantMerge: false,
    validatorListHashShort: 0x11223344,
    catchainSeqno: 9,
    minimumReferencedMasterchainSeqno: 100,
    masterchainReference: {
      workchain: -1,
      shard: FULL_SHARD,
      seqno: 114,
      rootHash: "6".repeat(64),
      fileHash: "7".repeat(64),
      endLt: "900",
    },
    previousBlocks: [],
    previousVerticalBlock: null,
    oldStateHash: "8".repeat(64),
    newStateHash: stateRoot.hash(0).toString("hex"),
    proofRootHash: "9".repeat(64),
  };
  const accountProofBoc = serializeBocRoots([
    convertToMerkleProof(blockRoot),
    convertToMerkleProof(stateRoot),
  ]);
  const accountStateRoot = options.separateAccountRoot ?? dictionaryAccountRoot;
  return {
    block,
    blockRoot,
    stateRoot,
    accountProofBoc,
    accountStateRoot,
    accountStateBoc: accountStateRoot.toBoc({ idx: false, crc32: false }),
  };
}

function verify(input = fixture()) {
  return verifyTonAccountStateProof(
    input.block,
    input.accountProofBoc,
    input.accountStateBoc,
    { accountAddress: accountAddress.toRawString(), limits },
  );
}

describe("TON finalized account-state proof", () => {
  it("proves an active account and preserves the non-authorizing boundary", () => {
    const result = verify();
    expect(result).toMatchObject({
      kind: "TON_PROVEN_ACTIVE_ACCOUNT_STATE",
      shardBlockFinalityProven: true,
      shardStateProofVerified: true,
      accountDictionaryInclusionVerified: true,
      accountStateProofVerified: true,
      transactionInclusionVerified: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      accountAddress: accountAddress.toRawString(),
      lastTransactionHash: "55".repeat(32),
      lastTransactionLt: "700",
      balanceNanotons: "2000000000",
      codeHash: code.hash(0).toString("hex"),
      dataHash: data.hash(0).toString("hex"),
    });
  });

  it("rejects a header proof detached from the finalized shard block", () => {
    const input = fixture();
    const other = beginCell().storeUint(1, 1).endCell();
    input.accountProofBoc = serializeBocRoots([
      convertToMerkleProof(other),
      convertToMerkleProof(input.stateRoot),
    ]);
    expect(() => verify(input)).toThrow("header root");
  });

  it("rejects a shard-state proof detached from the block state update", () => {
    const input = fixture();
    const other = beginCell().storeUint(2, 2).endCell();
    input.accountProofBoc = serializeBocRoots([
      convertToMerkleProof(input.blockRoot),
      convertToMerkleProof(other),
    ]);
    expect(() => verify(input)).toThrow("state root");
  });

  it.each([
    ["network", { globalId: -239 }],
    ["workchain", { workchain: -1 }],
    ["shard", { shard: LEFT_SHARD, shardPrefixBits: 1 }],
    ["sequence", { seqno: 78 }],
    ["vertical sequence", { verticalSeqno: 1 }],
    ["generation time", { generatedAtUnix: 1_800_000_191 }],
    ["logical time", { generatedLt: 20_001n }],
    ["masterchain reference", { minimumReferencedMasterchainSeqno: 101 }],
    ["split intent", { beforeSplit: true }],
  ] as const)("rejects shard-state %s drift", (_label, mutation) => {
    expect(() => verify(fixture(mutation))).toThrow("state identity");
  });

  it("rejects an account outside the proven shard prefix", () => {
    expect(() => verify(fixture({ blockShard: RIGHT_SHARD }))).toThrow(
      "cannot contain",
    );
  });

  it("rejects proven absence at a mismatching dictionary label", () => {
    expect(() => verify(fixture({ dictionaryAddress: otherAddress }))).toThrow(
      "absent",
    );
  });

  it("rejects an account path hidden by a pruned branch", () => {
    expect(() => verify(fixture({ pruneDictionaryRoot: true }))).toThrow(
      "hidden by pruning",
    );
  });

  it("accepts a complete augmented-dictionary path with an unrelated pruned sibling", () => {
    expect(
      verify(fixture({ forkedDictionary: true, pruneUnrelatedSibling: true }))
        .accountAddress,
    ).toBe(accountAddress.toRawString());
  });

  it("rejects an account-state root not committed by ShardAccount", () => {
    const substituted = activeAccountRoot({ accountAddress: otherAddress });
    expect(() => verify(fixture({ separateAccountRoot: substituted }))).toThrow(
      "state hash",
    );
  });

  it("rejects an account whose embedded address is substituted", () => {
    expect(() => verify(fixture({ accountAddress: otherAddress }))).toThrow(
      "address is substituted",
    );
  });

  it("rejects disagreement between AccountStorage and ShardAccount LT", () => {
    expect(() => verify(fixture({ accountLastTransactionLt: 701n }))).toThrow(
      "last transaction LT",
    );
  });

  it("rejects a non-active account", () => {
    expect(() => verify(fixture({ accountState: "uninit" }))).toThrow(
      "not active",
    );
  });

  it.each([
    ["code", { includeCode: false }],
    ["data", { includeData: false }],
  ] as const)("rejects an active account without %s", (_label, mutation) => {
    expect(() => verify(fixture(mutation))).toThrow("no code or data");
  });

  it("rejects a non-canonical one-root account proof", () => {
    const input = fixture();
    input.accountProofBoc = convertToMerkleProof(input.stateRoot).toBoc({
      idx: false,
      crc32: false,
    });
    expect(() => verify(input)).toThrow("exactly 2 complete roots");
  });

  it("rejects trailing account-state bytes", () => {
    const input = fixture();
    input.accountStateBoc = Buffer.concat([
      input.accountStateBoc,
      Buffer.from([0]),
    ]);
    expect(() => verify(input)).toThrow("trailing or missing");
  });

  it("enforces the shared BOC resource budget", () => {
    const input = fixture();
    expect(() =>
      verifyTonAccountStateProof(
        input.block,
        input.accountProofBoc,
        input.accountStateBoc,
        {
          accountAddress: accountAddress.toRawString(),
          limits: { ...limits, maxCells: 1 },
        },
      ),
    ).toThrow("cell count");
  });

  it("uses a dedicated error for invalid shard-block provenance", () => {
    const input = fixture();
    input.block.authorizationAllowed = true as false;
    expect(() => verify(input)).toThrow(TonAccountStateProofError);
  });
});
