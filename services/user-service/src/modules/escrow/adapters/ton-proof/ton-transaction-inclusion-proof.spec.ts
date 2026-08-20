import {
  Address,
  beginCell,
  Builder,
  Cell,
  convertToMerkleProof,
  Dictionary,
  Message,
  storeCurrencyCollection,
  storeTransaction,
  Transaction,
} from "@ton/core";
import type { TonProvenShardBlockHeader } from "./ton-shard-block-proof";
import {
  TonTransactionInclusionProofError,
  verifyTonTransactionInclusionProof,
} from "./ton-transaction-inclusion-proof";

const GLOBAL_ID = -3;
const FULL_SHARD = "-9223372036854775808";
const RIGHT_SHARD = "-4611686018427387904";
const account = Address.parseRaw(`0:${"11".repeat(32)}`);
const otherAccount = Address.parseRaw(`0:${"ee".repeat(32)}`);
const LT = 700n;
const limits = { maxBocBytes: 250_000, maxCells: 10_000, maxDepth: 256 };
const oldStateHash = Buffer.alloc(32, 0x44);
const newStateHash = Buffer.alloc(32, 0x55);

function transactionCell(
  address = account,
  lt = LT,
  now = 1_800_000_180,
): Cell {
  const transaction: Transaction = {
    address: BigInt(`0x${address.hash.toString("hex")}`),
    lt,
    prevTransactionHash: BigInt(`0x${"22".repeat(32)}`),
    prevTransactionLt: 600n,
    now,
    outMessagesCount: 0,
    oldStatus: "active",
    endStatus: "active",
    inMessage: undefined,
    outMessages: Dictionary.empty<number, Message>(),
    totalFees: { coins: 0n },
    stateUpdate: { oldHash: oldStateHash, newHash: newStateHash },
    description: {
      type: "generic",
      creditFirst: false,
      computePhase: { type: "skipped", reason: "no-state" },
      aborted: true,
      destroyed: false,
    },
    raw: beginCell().endCell(),
    hash: () => Buffer.alloc(32),
  };
  return beginCell().store(storeTransaction(transaction)).endCell();
}

function storeLongLabel(
  builder: Builder,
  key: bigint,
  totalBits: number,
  offset: number,
): Builder {
  const remaining = totalBits - offset;
  const lengthBits = Math.ceil(Math.log2(remaining + 1));
  const suffix = key & ((1n << BigInt(remaining)) - 1n);
  return builder
    .storeBit(true)
    .storeBit(false)
    .storeUint(remaining, lengthBits)
    .storeUint(suffix, remaining);
}

function transactionMap(transaction: Cell, key = LT, offset = 0): Cell {
  return storeLongLabel(beginCell(), key, 64, offset)
    .store(storeCurrencyCollection({ coins: 0n }))
    .storeRef(transaction)
    .endCell();
}

function stateUpdate(tag = 0x72): Cell {
  return beginCell()
    .storeUint(tag, 8)
    .storeBuffer(Buffer.alloc(32, 0x66))
    .storeBuffer(Buffer.alloc(32, 0x77))
    .endCell();
}

function accountLeaf(input: {
  dictionaryAddress?: Address;
  embeddedAddress?: Address;
  transaction?: Cell;
  transactionKey?: bigint;
  accountOffset?: number;
  transactionOffset?: number;
  transactionBranch?: boolean;
  pruneUnrelatedTransaction?: boolean;
  stateUpdateTag?: number;
} = {}): Cell {
  const dictionaryAddress = input.dictionaryAddress ?? account;
  const embeddedAddress = input.embeddedAddress ?? account;
  const transaction = input.transaction ?? transactionCell();
  let transactions = transactionMap(
    transaction,
    input.transactionKey ?? LT,
    input.transactionOffset ?? 0,
  );
  if (input.transactionBranch) {
    const selected = transactionMap(transaction, LT, 1);
    const unrelated = transactionMap(transactionCell(otherAccount, 1n << 63n), 1n << 63n, 1);
    transactions = beginCell()
      .storeBit(false)
      .storeBit(false)
      .storeRef(selected)
      .storeRef(input.pruneUnrelatedTransaction ? prunedBranch(unrelated) : unrelated)
      .store(storeCurrencyCollection({ coins: 0n }))
      .endCell();
  }
  return storeLongLabel(
    beginCell(),
    BigInt(`0x${dictionaryAddress.hash.toString("hex")}`),
    256,
    input.accountOffset ?? 0,
  )
    .store(storeCurrencyCollection({ coins: 0n }))
    .storeUint(0x5, 4)
    .storeBuffer(embeddedAddress.hash)
    .storeSlice(transactions.beginParse())
    .storeRef(stateUpdate(input.stateUpdateTag))
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

interface FixtureOptions {
  transaction?: Cell;
  transactionBoc?: Cell;
  dictionaryAddress?: Address;
  embeddedAddress?: Address;
  transactionKey?: bigint;
  stateUpdateTag?: number;
  pruneAccountPath?: boolean;
  accountBranch?: boolean;
  pruneUnrelatedAccount?: boolean;
  transactionBranch?: boolean;
  pruneUnrelatedTransaction?: boolean;
  pruneTransactionReference?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const fullTransaction = options.transaction ?? transactionCell();
  const transactionReference = options.pruneTransactionReference
    ? prunedBranch(fullTransaction)
    : fullTransaction;
  let root = accountLeaf({
    dictionaryAddress: options.dictionaryAddress,
    embeddedAddress: options.embeddedAddress,
    transaction: transactionReference,
    transactionKey: options.transactionKey,
    stateUpdateTag: options.stateUpdateTag,
    transactionBranch: options.transactionBranch,
    pruneUnrelatedTransaction: options.pruneUnrelatedTransaction,
  });
  if (options.accountBranch) {
    const selected = accountLeaf({
      transaction: transactionReference,
      accountOffset: 1,
      transactionBranch: options.transactionBranch,
      pruneUnrelatedTransaction: options.pruneUnrelatedTransaction,
    });
    const unrelated = accountLeaf({
      dictionaryAddress: otherAccount,
      embeddedAddress: otherAccount,
      transaction: transactionCell(otherAccount),
      accountOffset: 1,
    });
    root = beginCell()
      .storeBit(false)
      .storeBit(false)
      .storeRef(selected)
      .storeRef(options.pruneUnrelatedAccount ? prunedBranch(unrelated) : unrelated)
      .store(storeCurrencyCollection({ coins: 0n }))
      .endCell();
  }
  if (options.pruneAccountPath) root = prunedBranch(root);
  const accountBlocks = beginCell()
    .storeBit(true)
    .storeRef(root)
    .store(storeCurrencyCollection({ coins: 0n }))
    .endCell();
  const dummy = beginCell().storeBit(false).endCell();
  const extra = beginCell()
    .storeRef(dummy)
    .storeRef(dummy)
    .storeRef(accountBlocks)
    .storeBuffer(Buffer.alloc(32, 0x88))
    .storeBuffer(Buffer.alloc(32, 0x99))
    .storeBit(false)
    .endCell();
  const blockRoot = beginCell()
    .storeUint(0x11ef55aa, 32)
    .storeInt(GLOBAL_ID, 32)
    .storeRef(dummy)
    .storeRef(dummy)
    .storeRef(dummy)
    .storeRef(extra)
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
      rootHash: "aa".repeat(32),
      fileHash: "bb".repeat(32),
    },
    block: {
      workchain: 0,
      shard: FULL_SHARD,
      seqno: 77,
      rootHash: blockRoot.hash(0).toString("hex"),
      fileHash: "cc".repeat(32),
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
    validatorListHashShort: 1,
    catchainSeqno: 2,
    minimumReferencedMasterchainSeqno: 100,
    masterchainReference: {
      workchain: -1,
      shard: FULL_SHARD,
      seqno: 114,
      rootHash: "dd".repeat(32),
      fileHash: "ee".repeat(32),
      endLt: "900",
    },
    previousBlocks: [],
    previousVerticalBlock: null,
    oldStateHash: "12".repeat(32),
    newStateHash: "34".repeat(32),
    proofRootHash: "56".repeat(32),
  };
  const transactionBocRoot = options.transactionBoc ?? fullTransaction;
  return {
    block,
    blockRoot,
    fullTransaction,
    proof: convertToMerkleProof(blockRoot).toBoc({ idx: false, crc32: false }),
    transactionBoc: transactionBocRoot.toBoc({ idx: false, crc32: false }),
  };
}

function verify(input = fixture()) {
  return verifyTonTransactionInclusionProof(
    input.block,
    input.proof,
    input.transactionBoc,
    {
      accountAddress: account.toRawString(),
      transactionLt: LT.toString(),
      transactionHash: input.fullTransaction.hash(0).toString("hex"),
      limits,
    },
  );
}

describe("TON shard transaction inclusion proof", () => {
  it("proves a full transaction through AccountBlock and remains non-authorizing", () => {
    const input = fixture();
    const result = verify(input);
    expect(result).toMatchObject({
      kind: "TON_PROVEN_SHARD_TRANSACTION",
      shardBlockFinalityProven: true,
      accountBlockInclusionVerified: true,
      transactionDictionaryInclusionVerified: true,
      transactionCellVerified: true,
      transactionInclusionVerified: true,
      settlementAuthorized: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      accountAddress: account.toRawString(),
      transactionLt: "700",
      transactionHash: input.fullTransaction.hash(0).toString("hex"),
      previousTransactionHash: "22".repeat(32),
      previousTransactionLt: "600",
      transactionUnixTime: 1_800_000_180,
      transactionOldStateHash: oldStateHash.toString("hex"),
      transactionNewStateHash: newStateHash.toString("hex"),
      accountBlockOldStateHash: "66".repeat(32),
      accountBlockNewStateHash: "77".repeat(32),
    });
  });

  it("accepts a proof-pruned transaction reference bound to the complete transaction BOC", () => {
    expect(verify(fixture({ pruneTransactionReference: true })).transactionLt).toBe(
      "700",
    );
  });

  it("accepts unrelated pruned siblings in both augmented dictionaries", () => {
    expect(
      verify(
        fixture({
          accountBranch: true,
          pruneUnrelatedAccount: true,
          transactionBranch: true,
          pruneUnrelatedTransaction: true,
        }),
      ).transactionHash,
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a proof detached from the finalized shard block", () => {
    const input = fixture();
    input.block.block.rootHash = "ff".repeat(32);
    expect(() => verify(input)).toThrow("finalized shard block");
  });

  it("rejects an account outside the finalized shard prefix", () => {
    const input = fixture();
    input.block.block.shard = RIGHT_SHARD;
    expect(() => verify(input)).toThrow("cannot contain");
  });

  it("rejects a transaction BOC different from the expected hash", () => {
    const input = fixture();
    expect(() =>
      verifyTonTransactionInclusionProof(input.block, input.proof, input.transactionBoc, {
        accountAddress: account.toRawString(),
        transactionLt: LT.toString(),
        transactionHash: "ff".repeat(32),
        limits,
      }),
    ).toThrow("expected transaction");
  });

  it("rejects zero transaction logical time", () => {
    const input = fixture();
    expect(() =>
      verifyTonTransactionInclusionProof(input.block, input.proof, input.transactionBoc, {
        accountAddress: account.toRawString(),
        transactionLt: "0",
        transactionHash: input.fullTransaction.hash(0).toString("hex"),
        limits,
      }),
    ).toThrow("positive uint64");
  });

  it.each([
    ["account", transactionCell(otherAccount, LT)],
    ["logical time", transactionCell(account, LT + 1n)],
  ])("rejects transaction %s substitution", (_label, substituted) => {
    const input = fixture({ transaction: substituted });
    expect(() => verify(input)).toThrow("transaction identity");
  });

  it("rejects proven absence at another account dictionary key", () => {
    expect(() => verify(fixture({ dictionaryAddress: otherAccount }))).toThrow(
      "account block is absent",
    );
  });

  it("rejects an AccountBlock that embeds another account", () => {
    expect(() => verify(fixture({ embeddedAddress: otherAccount }))).toThrow(
      "substituted account",
    );
  });

  it("rejects proven absence at another transaction key", () => {
    expect(() => verify(fixture({ transactionKey: LT + 1n }))).toThrow(
      "transaction is absent",
    );
  });

  it("rejects a target account path hidden by pruning", () => {
    expect(() => verify(fixture({ pruneAccountPath: true }))).toThrow(
      "hidden by pruning",
    );
  });

  it("rejects a transaction reference substituted inside the proof", () => {
    const completeTransaction = transactionCell();
    const input = fixture({
      transaction: transactionCell(account, LT, 1_800_000_181),
      transactionBoc: completeTransaction,
    });
    expect(() =>
      verifyTonTransactionInclusionProof(input.block, input.proof, input.transactionBoc, {
        accountAddress: account.toRawString(),
        transactionLt: LT.toString(),
        transactionHash: completeTransaction.hash(0).toString("hex"),
        limits,
      }),
    ).toThrow("transaction reference");
  });

  it("rejects a malformed AccountBlock state update", () => {
    expect(() => verify(fixture({ stateUpdateTag: 0x73 }))).toThrow(
      "state update tag",
    );
  });

  it("rejects trailing transaction BOC bytes", () => {
    const input = fixture();
    input.transactionBoc = Buffer.concat([input.transactionBoc, Buffer.from([0])]);
    expect(() => verify(input)).toThrow("trailing or missing");
  });

  it("enforces the shared proof resource budget", () => {
    const input = fixture();
    expect(() =>
      verifyTonTransactionInclusionProof(input.block, input.proof, input.transactionBoc, {
        accountAddress: account.toRawString(),
        transactionLt: LT.toString(),
        transactionHash: input.fullTransaction.hash(0).toString("hex"),
        limits: { ...limits, maxCells: 1 },
      }),
    ).toThrow("cell count");
  });

  it("uses a dedicated error for forged shard-block provenance", () => {
    const input = fixture();
    input.block.authorizationAllowed = true as false;
    expect(() => verify(input)).toThrow(TonTransactionInclusionProofError);
  });
});
