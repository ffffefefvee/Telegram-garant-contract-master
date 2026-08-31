import {
  Address,
  Cell,
  CellType,
  loadAccount,
  loadDepthBalanceInfo,
  loadShardIdent,
  Slice,
} from "@ton/core";
import type {
  TonProofBlockId,
  TonProofResourceLimits,
} from "./ton-proof-envelope";
import {
  parseTonAccountProofBoc,
  parseTonSingleRootBoc,
} from "./ton-proof-envelope";
import type { TonProvenShardBlockHeader } from "./ton-shard-block-proof";
import { canonicalTonShardId } from "./ton-shard-ident";

const SHARD_STATE_TAG = 0x9023afe2;

export interface TonAccountStateProofExpectation {
  accountAddress: string;
  limits: TonProofResourceLimits;
}

export interface TonProvenActiveAccountState {
  kind: "TON_PROVEN_ACTIVE_ACCOUNT_STATE";
  shardBlockFinalityProven: true;
  shardStateProofVerified: true;
  accountDictionaryInclusionVerified: true;
  accountStateProofVerified: true;
  transactionInclusionVerified: false;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  networkGlobalId: number;
  finalizedByMasterchainBlock: TonProofBlockId;
  block: TonProofBlockId;
  generatedAtUnix: number;
  blockEndLt: string;
  accountAddress: string;
  shardStateHash: string;
  shardStateProofRootHash: string;
  accountProofBocHash: string;
  accountStateHash: string;
  accountStateBocHash: string;
  lastTransactionHash: string;
  lastTransactionLt: string;
  balanceNanotons: string;
  codeHash: string;
  dataHash: string;
  accountStateRoot: Cell;
  code: Cell;
  data: Cell;
}

interface ProvenDictionaryEntry {
  accountHash: string;
  lastTransactionHash: string;
  lastTransactionLt: bigint;
}

type DictionaryLookup =
  | { status: "present"; entry: ProvenDictionaryEntry }
  | { status: "absent" | "unproven" };

export class TonAccountStateProofError extends Error {
  readonly name = "TonAccountStateProofError";
}

function reject(message: string): never {
  throw new TonAccountStateProofError(message);
}

function parseRawAddress(value: string): Address {
  if (!/^-?\d+:[0-9a-f]{64}$/.test(value)) {
    reject("account address must be canonical raw lowercase form");
  }
  try {
    const address = Address.parseRaw(value);
    if (address.toRawString() !== value)
      reject("account address is not canonical");
    return address;
  } catch (error) {
    if (error instanceof TonAccountStateProofError) throw error;
    reject("account address is invalid");
  }
}

function shardContainsAddress(
  block: TonProofBlockId,
  address: Address,
): boolean {
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
  if (prefixBits < 0 || prefixBits > 60) {
    return false;
  }
  if (prefixBits === 0) return true;
  const accountPrefix = address.hash.readBigUInt64BE(0);
  const prefixMask = BigInt.asUintN(64, ~((lowerBit << 1n) - 1n));
  return (accountPrefix & prefixMask) === (rawShard & prefixMask);
}

function parseLabel(source: Slice, remaining: number): string {
  let repeated: boolean | undefined;
  let length: number;
  if (!source.loadBit()) {
    length = 0;
    while (source.loadBit()) {
      length += 1;
      if (length > remaining)
        reject("account dictionary short label is too long");
    }
  } else if (!source.loadBit()) {
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("account dictionary long label is too long");
  } else {
    repeated = source.loadBit();
    const bits = Math.ceil(Math.log2(remaining + 1));
    length = bits === 0 ? 0 : source.loadUint(bits);
    if (length > remaining) reject("account dictionary same label is too long");
  }
  let label = "";
  for (let index = 0; index < length; index += 1) {
    label += (repeated ?? source.loadBit()) ? "1" : "0";
  }
  return label;
}

function lookupShardAccount(root: Cell, key: string): DictionaryLookup {
  let node = root;
  let offset = 0;
  let remaining = key.length;
  for (;;) {
    if (node.type === CellType.PrunedBranch) return { status: "unproven" };
    if (node.type !== CellType.Ordinary) {
      reject("account dictionary path contains a non-ordinary cell");
    }
    try {
      const source = node.beginParse();
      const label = parseLabel(source, remaining);
      const afterLabel = remaining - label.length;
      if (label !== key.slice(offset, offset + label.length)) {
        return { status: "absent" };
      }
      offset += label.length;
      if (afterLabel === 0) {
        loadDepthBalanceInfo(source);
        const account = source.loadRef();
        const lastTransactionHash = source
          .loadUintBig(256)
          .toString(16)
          .padStart(64, "0");
        const lastTransactionLt = source.loadUintBig(64);
        source.endParse();
        return {
          status: "present",
          entry: {
            accountHash: account.hash(0).toString("hex"),
            lastTransactionHash,
            lastTransactionLt,
          },
        };
      }
      const left = source.loadRef();
      const right = source.loadRef();
      loadDepthBalanceInfo(source);
      source.endParse();
      const branch = key[offset];
      offset += 1;
      remaining = afterLabel - 1;
      node = branch === "0" ? left : right;
    } catch (error) {
      if (error instanceof TonAccountStateProofError) throw error;
      reject(
        `account dictionary is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}

function accountDictionaryLookup(
  stateRoot: Cell,
  block: TonProvenShardBlockHeader,
  address: Address,
): DictionaryLookup {
  if (stateRoot.type !== CellType.Ordinary)
    reject("shard state root is absent");
  try {
    const state = stateRoot.beginParse();
    if (state.loadUint(32) !== SHARD_STATE_TAG) {
      reject("state proof does not contain ShardStateUnsplit");
    }
    const globalId = state.loadInt(32);
    const shard = loadShardIdent(state);
    const seqno = state.loadUint(32);
    const verticalSeqno = state.loadUint(32);
    const generatedAtUnix = state.loadUint(32);
    const generatedLt = state.loadUintBig(64);
    const minimumReferencedMasterchainSeqno = state.loadUint(32);
    state.loadRef();
    const beforeSplit = state.loadBit();
    const accounts = state.loadRef();
    state.loadRef();
    state.loadMaybeRef();
    state.endParse();
    if (
      globalId !== block.networkGlobalId ||
      shard.workchainId !== block.block.workchain ||
      canonicalTonShardId(shard) !== block.block.shard ||
      seqno !== block.block.seqno ||
      verticalSeqno !== block.verticalSeqno ||
      generatedAtUnix !== block.generatedAtUnix ||
      generatedLt.toString() !== block.endLt ||
      minimumReferencedMasterchainSeqno !==
        block.minimumReferencedMasterchainSeqno ||
      beforeSplit !== block.beforeSplit
    ) {
      reject("shard state identity does not match the proven block");
    }
    if (accounts.type !== CellType.Ordinary) {
      reject("ShardAccounts root is hidden by pruning");
    }
    const dictionary = accounts.beginParse();
    const present = dictionary.loadBit();
    if (!present) {
      loadDepthBalanceInfo(dictionary);
      dictionary.endParse();
      return { status: "absent" };
    }
    const root = dictionary.loadRef();
    loadDepthBalanceInfo(dictionary);
    dictionary.endParse();
    return lookupShardAccount(
      root,
      BigInt(`0x${address.hash.toString("hex")}`)
        .toString(2)
        .padStart(256, "0"),
    );
  } catch (error) {
    if (error instanceof TonAccountStateProofError) throw error;
    reject(
      `shard state proof is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function verifyTonAccountStateProof(
  block: TonProvenShardBlockHeader,
  accountProofBoc: Buffer,
  accountStateBoc: Buffer,
  expectation: TonAccountStateProofExpectation,
): TonProvenActiveAccountState {
  if (
    block.shardBlockFinalityProven !== true ||
    block.shardStateProofVerified !== false ||
    block.authorizationAllowed !== false ||
    block.verificationEvidenceHash !== null
  ) {
    reject("shard block provenance is invalid");
  }
  const address = parseRawAddress(expectation.accountAddress);
  if (!shardContainsAddress(block.block, address)) {
    reject("proven shard cannot contain the requested account");
  }
  const proof = parseTonAccountProofBoc(
    accountProofBoc,
    expectation.limits,
    "account_proof",
  );
  const [headerProof, stateProof] = proof.roots;
  if (headerProof.virtualRootHash !== block.block.rootHash) {
    reject(
      "account proof header root does not match the finalized shard block",
    );
  }
  if (stateProof.virtualRootHash !== block.newStateHash) {
    reject(
      "account proof state root does not match the shard block state update",
    );
  }
  const lookup = accountDictionaryLookup(
    stateProof.virtualRoot,
    block,
    address,
  );
  if (lookup.status !== "present") {
    reject(
      lookup.status === "unproven"
        ? "account dictionary path is hidden by pruning"
        : "account is absent from the proven shard state",
    );
  }
  const accountState = parseTonSingleRootBoc(
    accountStateBoc,
    expectation.limits,
    "account_state",
  );
  if (accountState.rootHash !== lookup.entry.accountHash) {
    reject("account state hash does not match the proven dictionary entry");
  }
  if (accountState.root.type !== CellType.Ordinary) {
    reject("account state root is not an ordinary cell");
  }
  try {
    const source = accountState.root.beginParse();
    if (!source.loadBit()) reject("proven account is non-existent");
    const account = loadAccount(source);
    source.endParse();
    if (!account.addr.equals(address))
      reject("account state address is substituted");
    if (
      (account.storage.lastTransLt < 1n ? 1n : account.storage.lastTransLt) <=
      lookup.entry.lastTransactionLt
    ) {
      reject(
        `account storage end LT ${account.storage.lastTransLt} does not advance ShardAccount transaction LT ${lookup.entry.lastTransactionLt}`,
      );
    }
    if (account.storage.state.type !== "active") {
      reject("proven account is not active");
    }
    const code = account.storage.state.state.code;
    const data = account.storage.state.state.data;
    if (!code || !data) reject("active account has no code or data");
    return {
      kind: "TON_PROVEN_ACTIVE_ACCOUNT_STATE",
      shardBlockFinalityProven: true,
      shardStateProofVerified: true,
      accountDictionaryInclusionVerified: true,
      accountStateProofVerified: true,
      transactionInclusionVerified: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      networkGlobalId: block.networkGlobalId,
      finalizedByMasterchainBlock: { ...block.finalizedByMasterchainBlock },
      block: { ...block.block },
      generatedAtUnix: block.generatedAtUnix,
      blockEndLt: block.endLt,
      accountAddress: address.toRawString(),
      shardStateHash: block.newStateHash,
      shardStateProofRootHash: stateProof.rootHash,
      accountProofBocHash: proof.bocHash,
      accountStateHash: accountState.rootHash,
      accountStateBocHash: accountState.bocHash,
      lastTransactionHash: lookup.entry.lastTransactionHash,
      lastTransactionLt: lookup.entry.lastTransactionLt.toString(),
      balanceNanotons: account.storage.balance.coins.toString(),
      codeHash: code.hash(0).toString("hex"),
      dataHash: data.hash(0).toString("hex"),
      accountStateRoot: accountState.root,
      code,
      data,
    };
  } catch (error) {
    if (error instanceof TonAccountStateProofError) throw error;
    reject(
      `account state is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
