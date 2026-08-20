import { Cell, CellType, exoticMerkleUpdate, loadShardIdent } from "@ton/core";
import type { TonProofBlockId } from "./ton-proof-envelope";

const BLOCK_TAG = 0x11ef55aa;
const BLOCK_INFO_TAG = 0x9bc7a987;
const GLOBAL_VERSION_TAG = 0xc4;
const MASTERCHAIN_SHARD = "-9223372036854775808";
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface TonMasterchainHeaderExpectation {
  globalId: number;
  targetBlock: TonProofBlockId;
  trustedKeyBlockSeqno: number;
}

export interface TonProvenMasterchainHeader {
  kind: "TON_PROVEN_MASTERCHAIN_HEADER";
  rootHashVerified: true;
  fileHashVerified: false;
  signaturesVerified: false;
  finalityProven: false;
  globalId: number;
  block: TonProofBlockId;
  version: number;
  verticalSeqno: number;
  generatedAtUnix: number;
  startLt: string;
  endLt: string;
  keyBlock: boolean;
  validatorListHashShort: number;
  catchainSeqno: number;
  minReferencedMasterchainSeqno: number;
  previousKeyBlockSeqno: number;
  previousBlock: TonProofBlockId & { endLt: string };
  previousVerticalBlock: (TonProofBlockId & { endLt: string }) | null;
  software: { version: number; capabilities: string } | null;
  oldStateHash: string;
  newStateHash: string;
}

interface ParsedExtBlockRef {
  endLt: bigint;
  seqno: number;
  rootHash: string;
  fileHash: string;
}

export class TonMasterchainHeaderProofError extends Error {
  readonly name = "TonMasterchainHeaderProofError";
}

function reject(message: string): never {
  throw new TonMasterchainHeaderProofError(message);
}

function requireUint32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    reject(`${label} is not uint32`);
  }
}

function requireHash(value: string, label: string): void {
  if (!HASH_PATTERN.test(value) || value === "0".repeat(64)) {
    reject(`${label} is invalid`);
  }
}

function signedShardString(shardPrefix: bigint): string {
  if (shardPrefix < 0n || shardPrefix >= 1n << 64n) {
    reject("shard prefix is outside uint64");
  }
  return (
    shardPrefix >= 1n << 63n ? shardPrefix - (1n << 64n) : shardPrefix
  ).toString();
}

function parseExtBlockRef(cell: Cell, label: string): ParsedExtBlockRef {
  if (cell.type !== CellType.Ordinary) {
    reject(`${label} must be an ordinary cell`);
  }
  try {
    const slice = cell.beginParse();
    const value = {
      endLt: slice.loadUintBig(64),
      seqno: slice.loadUint(32),
      rootHash: slice.loadBuffer(32).toString("hex"),
      fileHash: slice.loadBuffer(32).toString("hex"),
    };
    slice.endParse();
    requireHash(value.rootHash, `${label}.rootHash`);
    requireHash(value.fileHash, `${label}.fileHash`);
    return value;
  } catch (error) {
    if (error instanceof TonMasterchainHeaderProofError) throw error;
    reject(
      `${label} is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function blockIdFromRef(
  ref: ParsedExtBlockRef,
): TonProofBlockId & { endLt: string } {
  return {
    workchain: -1,
    shard: MASTERCHAIN_SHARD,
    seqno: ref.seqno,
    rootHash: ref.rootHash,
    fileHash: ref.fileHash,
    endLt: ref.endLt.toString(),
  };
}

function parseStateUpdate(cell: Cell): {
  oldStateHash: string;
  newStateHash: string;
} {
  if (cell.type !== CellType.MerkleUpdate) {
    reject("block state_update must be a MerkleUpdate cell");
  }
  try {
    const update = exoticMerkleUpdate(cell.bits, cell.refs);
    return {
      oldStateHash: update.proofHash1.toString("hex"),
      newStateHash: update.proofHash2.toString("hex"),
    };
  } catch (error) {
    reject(
      `block state_update is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function validateExpectation(
  expectation: TonMasterchainHeaderExpectation,
): void {
  if (
    !Number.isSafeInteger(expectation.globalId) ||
    expectation.globalId < -0x80000000 ||
    expectation.globalId > 0x7fffffff
  ) {
    reject("globalId is invalid");
  }
  requireUint32(expectation.targetBlock.seqno, "targetBlock.seqno");
  requireUint32(expectation.trustedKeyBlockSeqno, "trustedKeyBlockSeqno");
  requireHash(expectation.targetBlock.rootHash, "targetBlock.rootHash");
  requireHash(expectation.targetBlock.fileHash, "targetBlock.fileHash");
  if (
    expectation.targetBlock.workchain !== -1 ||
    expectation.targetBlock.shard !== MASTERCHAIN_SHARD
  ) {
    reject("targetBlock is not a masterchain block");
  }
  if (expectation.targetBlock.seqno <= expectation.trustedKeyBlockSeqno) {
    reject("targetBlock does not advance the trusted key block");
  }
}

export function verifyTonMasterchainHeaderCell(
  virtualRoot: Cell,
  expectation: TonMasterchainHeaderExpectation,
): TonProvenMasterchainHeader {
  validateExpectation(expectation);
  if (virtualRoot.type !== CellType.Ordinary) {
    reject("Merkle proof virtual root must be an ordinary Block cell");
  }
  const rootHash = virtualRoot.hash().toString("hex");
  if (rootHash !== expectation.targetBlock.rootHash) {
    reject("Merkle proof virtual root does not match targetBlock.rootHash");
  }

  let globalId: number;
  let infoCell: Cell;
  let stateUpdateCell: Cell;
  try {
    const block = virtualRoot.beginParse();
    if (block.loadUint(32) !== BLOCK_TAG)
      reject("virtual root is not a TON Block");
    globalId = block.loadInt(32);
    infoCell = block.loadRef();
    block.loadRef(); // ValueFlow remains hash-committed and is verified in a later slice.
    stateUpdateCell = block.loadRef();
    block.loadRef(); // BlockExtra remains hash-committed and is verified in a later slice.
    block.endParse();
  } catch (error) {
    if (error instanceof TonMasterchainHeaderProofError) throw error;
    reject(
      `TON Block root is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (globalId !== expectation.globalId) {
    reject("TON Block global_id does not match the trusted network");
  }
  if (infoCell.type !== CellType.Ordinary) {
    reject("BlockInfo must be present as an ordinary proof cell");
  }

  try {
    const info = infoCell.beginParse();
    if (info.loadUint(32) !== BLOCK_INFO_TAG) reject("invalid BlockInfo tag");
    const version = info.loadUint(32);
    if (version !== 0) reject("unsupported BlockInfo version");
    const notMaster = info.loadBit();
    const afterMerge = info.loadBit();
    const beforeSplit = info.loadBit();
    const afterSplit = info.loadBit();
    const wantSplit = info.loadBit();
    const wantMerge = info.loadBit();
    const keyBlock = info.loadBit();
    const verticalSeqnoIncrement = info.loadBit();
    const flags = info.loadUint(8);
    if (flags > 1) reject("unsupported BlockInfo flags");
    const seqno = info.loadUint(32);
    const verticalSeqno = info.loadUint(32);
    const shard = loadShardIdent(info);
    const generatedAtUnix = info.loadUint(32);
    const startLt = info.loadUintBig(64);
    const endLt = info.loadUintBig(64);
    const validatorListHashShort = info.loadUint(32);
    const catchainSeqno = info.loadUint(32);
    const minReferencedMasterchainSeqno = info.loadUint(32);
    const previousKeyBlockSeqno = info.loadUint(32);
    let software: { version: number; capabilities: string } | null = null;
    if ((flags & 1) !== 0) {
      if (info.loadUint(8) !== GLOBAL_VERSION_TAG) {
        reject("invalid GlobalVersion tag");
      }
      software = {
        version: info.loadUint(32),
        capabilities: info.loadUintBig(64).toString(),
      };
    }
    if (notMaster)
      reject("BlockInfo marks the masterchain block as non-master");
    if (afterMerge || beforeSplit || afterSplit || wantSplit || wantMerge) {
      reject("masterchain BlockInfo contains shard split/merge flags");
    }
    if (
      shard.workchainId !== -1 ||
      shard.shardPrefixBits !== 0 ||
      signedShardString(shard.shardPrefix) !== MASTERCHAIN_SHARD
    ) {
      reject("BlockInfo shard identity is not the masterchain");
    }
    if (seqno !== expectation.targetBlock.seqno) {
      reject("BlockInfo seqno does not match targetBlock.seqno");
    }
    if (verticalSeqno < Number(verticalSeqnoIncrement)) {
      reject("BlockInfo vertical sequence is invalid");
    }
    if (startLt >= endLt) reject("BlockInfo logical-time interval is invalid");
    if (minReferencedMasterchainSeqno > seqno) {
      reject("BlockInfo minimum referenced masterchain seqno is invalid");
    }
    if (previousKeyBlockSeqno !== expectation.trustedKeyBlockSeqno) {
      reject("BlockInfo previous key block does not match the trusted anchor");
    }

    const previousBlock = parseExtBlockRef(info.loadRef(), "previousBlock");
    if (previousBlock.seqno + 1 !== seqno) {
      reject("previousBlock is not the immediate masterchain predecessor");
    }
    const previousVerticalBlock = verticalSeqnoIncrement
      ? parseExtBlockRef(info.loadRef(), "previousVerticalBlock")
      : null;
    info.endParse();

    const state = parseStateUpdate(stateUpdateCell);
    return {
      kind: "TON_PROVEN_MASTERCHAIN_HEADER",
      rootHashVerified: true,
      fileHashVerified: false,
      signaturesVerified: false,
      finalityProven: false,
      globalId,
      block: { ...expectation.targetBlock },
      version,
      verticalSeqno,
      generatedAtUnix,
      startLt: startLt.toString(),
      endLt: endLt.toString(),
      keyBlock,
      validatorListHashShort,
      catchainSeqno,
      minReferencedMasterchainSeqno,
      previousKeyBlockSeqno,
      previousBlock: blockIdFromRef(previousBlock),
      previousVerticalBlock: previousVerticalBlock
        ? blockIdFromRef(previousVerticalBlock)
        : null,
      software,
      ...state,
    };
  } catch (error) {
    if (error instanceof TonMasterchainHeaderProofError) throw error;
    reject(
      `BlockInfo is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
