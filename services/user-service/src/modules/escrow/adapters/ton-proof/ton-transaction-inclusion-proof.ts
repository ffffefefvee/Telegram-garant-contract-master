import {
  Address,
  Cell,
  CellType,
  loadCurrencyCollection,
  loadTransaction,
  Slice,
} from "@ton/core";
import type {
  TonProofBlockId,
  TonProofResourceLimits,
} from "./ton-proof-envelope";
import {
  parseTonMerkleProofBoc,
  parseTonSingleRootBoc,
} from "./ton-proof-envelope";
import type { TonProvenShardBlockHeader } from "./ton-shard-block-proof";

const BLOCK_TAG = 0x11ef55aa;
const ACCOUNT_BLOCK_TAG = 0x5;
const HASH_UPDATE_TAG = 0x72;
const HASH = /^[0-9a-f]{64}$/;

export interface TonTransactionInclusionExpectation {
  accountAddress: string;
  transactionLt: string;
  transactionHash: string;
  limits: TonProofResourceLimits;
}

export interface TonProvenShardTransaction {
  kind: "TON_PROVEN_SHARD_TRANSACTION";
  shardBlockFinalityProven: true;
  accountBlockInclusionVerified: true;
  transactionDictionaryInclusionVerified: true;
  transactionCellVerified: true;
  transactionInclusionVerified: true;
  settlementAuthorized: false;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  networkGlobalId: number;
  finalizedByMasterchainBlock: TonProofBlockId;
  block: TonProofBlockId;
  accountAddress: string;
  transactionLt: string;
  transactionHash: string;
  transactionBocHash: string;
  inclusionProofBocHash: string;
  inclusionProofRootHash: string;
  previousTransactionHash: string;
  previousTransactionLt: string;
  transactionUnixTime: number;
  transactionOldStateHash: string;
  transactionNewStateHash: string;
  accountBlockOldStateHash: string;
  accountBlockNewStateHash: string;
  transactionRoot: Cell;
}

type Lookup<T> =
  | { status: "present"; value: T }
  | { status: "absent" | "unproven" };

interface TransactionReference {
  hash: string;
  type: CellType;
}

interface AccountBlockValue {
  transaction: TransactionReference;
  oldStateHash: string;
  newStateHash: string;
}

export class TonTransactionInclusionProofError extends Error {
  readonly name = "TonTransactionInclusionProofError";
}

function reject(message: string): never {
  throw new TonTransactionInclusionProofError(message);
}

function parseRawAddress(value: string): Address {
  if (!/^-?\d+:[0-9a-f]{64}$/.test(value)) {
    reject("accountAddress must be canonical raw lowercase form");
  }
  try {
    const result = Address.parseRaw(value);
    if (result.toRawString() !== value) reject("accountAddress is not canonical");
    return result;
  } catch (error) {
    if (error instanceof TonTransactionInclusionProofError) throw error;
    reject("accountAddress is invalid");
  }
}

function parseUint64(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    reject("transactionLt is not canonical uint64");
  }
  const result = BigInt(value);
  if (result === 0n || result > 0xffffffffffffffffn) {
    reject("transactionLt is outside positive uint64");
  }
  return result;
}

function shardContainsAddress(block: TonProofBlockId, address: Address): boolean {
  if (address.workChain !== block.workchain) return false;
  let rawShard: bigint;
  try {
    rawShard = BigInt.asUintN(64, BigInt(block.shard));
  } catch {
    return false;
  }
  const lowerBit = rawShard & -rawShard;
  if (lowerBit === 0n) return false;
  let lowerBitIndex = 0;
  for (let cursor = lowerBit; cursor > 1n; cursor >>= 1n) lowerBitIndex += 1;
  const prefixBits = 63 - lowerBitIndex;
  if (prefixBits < 0 || prefixBits > 60) return false;
  if (prefixBits === 0) return true;
  const accountPrefix = address.hash.readBigUInt64BE(0);
  const prefixMask = BigInt.asUintN(64, ~((lowerBit << 1n) - 1n));
  return (accountPrefix & prefixMask) === (rawShard & prefixMask);
}

function requireHash(value: string, label: string): void {
  if (!HASH.test(value) || value === "0".repeat(64)) reject(`${label} is invalid`);
}

function parseLabel(source: Slice, remaining: number): string {
  let repeated: boolean | undefined;
  let length: number;
  if (!source.loadBit()) {
    length = 0;
    while (source.loadBit()) {
      length += 1;
      if (length > remaining) reject("augmented dictionary short label is too long");
    }
  } else if (!source.loadBit()) {
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("augmented dictionary long label is too long");
  } else {
    repeated = source.loadBit();
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("augmented dictionary same label is too long");
  }
  let label = "";
  for (let index = 0; index < length; index += 1) {
    label += (repeated ?? source.loadBit()) ? "1" : "0";
  }
  return label;
}

function lookupAugmented<T>(
  source: Slice,
  key: string,
  offset: number,
  remaining: number,
  parseLeaf: (leaf: Slice) => T,
  child: boolean,
): Lookup<T> {
  const label = parseLabel(source, remaining);
  const afterLabel = remaining - label.length;
  if (label !== key.slice(offset, offset + label.length)) {
    return { status: "absent" };
  }
  offset += label.length;
  let result: Lookup<T>;
  if (afterLabel === 0) {
    // Canonical HashmapAug leaves store the augmentation before the value.
    loadCurrencyCollection(source);
    result = { status: "present", value: parseLeaf(source) };
  } else {
    const left = source.loadRef();
    const right = source.loadRef();
    loadCurrencyCollection(source);
    const selected = key[offset] === "0" ? left : right;
    if (selected.type === CellType.PrunedBranch) {
      result = { status: "unproven" };
    } else if (selected.type !== CellType.Ordinary) {
      reject("augmented dictionary path contains an exotic cell");
    } else {
      result = lookupAugmented(
        selected.beginParse(),
        key,
        offset + 1,
        afterLabel - 1,
        parseLeaf,
        true,
      );
    }
  }
  if (child) source.endParse();
  return result;
}

function parseHashUpdate(cell: Cell, label: string): {
  oldStateHash: string;
  newStateHash: string;
} {
  if (cell.type !== CellType.Ordinary) reject(`${label} is hidden by pruning`);
  try {
    const source = cell.beginParse();
    if (source.loadUint(8) !== HASH_UPDATE_TAG) reject(`${label} tag is invalid`);
    const result = {
      oldStateHash: source.loadBuffer(32).toString("hex"),
      newStateHash: source.loadBuffer(32).toString("hex"),
    };
    source.endParse();
    return result;
  } catch (error) {
    if (error instanceof TonTransactionInclusionProofError) throw error;
    reject(`${label} is malformed`);
  }
}

function parseAccountBlock(
  source: Slice,
  expectedAccountHash: bigint,
  transactionKey: string,
): AccountBlockValue {
  if (source.loadUint(4) !== ACCOUNT_BLOCK_TAG) {
    reject("AccountBlock tag is invalid");
  }
  if (source.loadUintBig(256) !== expectedAccountHash) {
    reject("AccountBlock embeds a substituted account address");
  }
  const transaction = lookupAugmented(
    source,
    transactionKey,
    0,
    64,
    (leaf) => {
      const reference = leaf.loadRef();
      if (
        reference.type !== CellType.Ordinary &&
        reference.type !== CellType.PrunedBranch
      ) {
        reject("transaction reference has an unsupported exotic type");
      }
      return {
        hash: reference.hash(0).toString("hex"),
        type: reference.type,
      };
    },
    false,
  );
  if (transaction.status !== "present") {
    reject(
      transaction.status === "unproven"
        ? "transaction dictionary path is hidden by pruning"
        : "transaction is absent from the proven AccountBlock",
    );
  }
  const state = parseHashUpdate(source.loadRef(), "AccountBlock state update");
  return { transaction: transaction.value, ...state };
}

function lookupAccountBlock(
  accountBlocks: Cell,
  accountKey: string,
  transactionKey: string,
): Lookup<AccountBlockValue> {
  if (accountBlocks.type !== CellType.Ordinary) {
    reject("ShardAccountBlocks root is hidden by pruning");
  }
  const source = accountBlocks.beginParse();
  if (!source.loadBit()) {
    loadCurrencyCollection(source);
    source.endParse();
    return { status: "absent" };
  }
  const root = source.loadRef();
  loadCurrencyCollection(source);
  source.endParse();
  if (root.type === CellType.PrunedBranch) return { status: "unproven" };
  if (root.type !== CellType.Ordinary) {
    reject("ShardAccountBlocks path has an unsupported exotic root");
  }
  return lookupAugmented(
    root.beginParse(),
    accountKey,
    0,
    256,
    (leaf) => {
      return parseAccountBlock(
        leaf,
        BigInt(`0b${accountKey}`),
        transactionKey,
      );
    },
    true,
  );
}

function accountBlocksFromProof(root: Cell, globalId: number): Cell {
  if (root.type !== CellType.Ordinary) reject("shard block root is absent");
  try {
    const block = root.beginParse();
    if (block.loadUint(32) !== BLOCK_TAG) reject("proof root is not a TON Block");
    if (block.loadInt(32) !== globalId) reject("shard block network is substituted");
    block.loadRef();
    block.loadRef();
    block.loadRef();
    const extraCell = block.loadRef();
    block.endParse();
    if (extraCell.type !== CellType.Ordinary) reject("BlockExtra is hidden by pruning");
    const extra = extraCell.beginParse();
    extra.loadRef();
    extra.loadRef();
    const accountBlocks = extra.loadRef();
    extra.loadBuffer(32);
    extra.loadBuffer(32);
    if (extra.loadMaybeRef()) reject("shard BlockExtra has masterchain custom data");
    extra.endParse();
    return accountBlocks;
  } catch (error) {
    if (error instanceof TonTransactionInclusionProofError) throw error;
    reject(
      `transaction inclusion proof is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function verifyTonTransactionInclusionProof(
  block: TonProvenShardBlockHeader,
  inclusionProofBoc: Buffer,
  transactionBoc: Buffer,
  expectation: TonTransactionInclusionExpectation,
): TonProvenShardTransaction {
  if (
    block.shardBlockFinalityProven !== true ||
    block.shardStateProofVerified !== false ||
    block.authorizationAllowed !== false ||
    block.verificationEvidenceHash !== null
  ) {
    reject("shard-block provenance is invalid");
  }
  const address = parseRawAddress(expectation.accountAddress);
  if (!shardContainsAddress(block.block, address)) {
    reject("finalized shard cannot contain the requested transaction account");
  }
  const transactionLt = parseUint64(expectation.transactionLt);
  requireHash(expectation.transactionHash, "transactionHash");
  const transaction = parseTonSingleRootBoc(
    transactionBoc,
    expectation.limits,
    "transaction",
  );
  if (transaction.rootHash !== expectation.transactionHash) {
    reject("transaction BOC hash does not match the expected transaction");
  }
  if (transaction.root.type !== CellType.Ordinary) {
    reject("transaction root is not an ordinary cell");
  }
  let decoded;
  try {
    const source = transaction.root.beginParse();
    decoded = loadTransaction(source);
    source.endParse();
  } catch (error) {
    reject(
      `transaction BOC is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const accountHash = BigInt(`0x${address.hash.toString("hex")}`);
  if (decoded.address !== accountHash || decoded.lt !== transactionLt) {
    reject("transaction identity does not match the requested account and LT");
  }

  const proof = parseTonMerkleProofBoc(
    inclusionProofBoc,
    expectation.limits,
    "transaction_inclusion_proof",
  );
  if (proof.virtualRootHash !== block.block.rootHash) {
    reject("transaction proof does not match the finalized shard block");
  }
  const accountBlocks = accountBlocksFromProof(
    proof.virtualRoot,
    block.networkGlobalId,
  );
  const lookup = lookupAccountBlock(
    accountBlocks,
    accountHash.toString(2).padStart(256, "0"),
    transactionLt.toString(2).padStart(64, "0"),
  );
  if (lookup.status !== "present") {
    reject(
      lookup.status === "unproven"
        ? "account-block dictionary path is hidden by pruning"
        : "account block is absent from the proven shard block",
    );
  }
  if (lookup.value.transaction.hash !== transaction.rootHash) {
    reject("proven transaction reference does not match the transaction BOC");
  }
  return {
    kind: "TON_PROVEN_SHARD_TRANSACTION",
    shardBlockFinalityProven: true,
    accountBlockInclusionVerified: true,
    transactionDictionaryInclusionVerified: true,
    transactionCellVerified: true,
    transactionInclusionVerified: true,
    settlementAuthorized: false,
    authorizationAllowed: false,
    verificationEvidenceHash: null,
    networkGlobalId: block.networkGlobalId,
    finalizedByMasterchainBlock: { ...block.finalizedByMasterchainBlock },
    block: { ...block.block },
    accountAddress: address.toRawString(),
    transactionLt: transactionLt.toString(),
    transactionHash: transaction.rootHash,
    transactionBocHash: transaction.bocHash,
    inclusionProofBocHash: proof.bocHash,
    inclusionProofRootHash: proof.rootHash,
    previousTransactionHash: decoded.prevTransactionHash
      .toString(16)
      .padStart(64, "0"),
    previousTransactionLt: decoded.prevTransactionLt.toString(),
    transactionUnixTime: decoded.now,
    transactionOldStateHash: decoded.stateUpdate.oldHash.toString("hex"),
    transactionNewStateHash: decoded.stateUpdate.newHash.toString("hex"),
    accountBlockOldStateHash: lookup.value.oldStateHash,
    accountBlockNewStateHash: lookup.value.newStateHash,
    transactionRoot: transaction.root,
  };
}
