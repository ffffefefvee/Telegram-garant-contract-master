import { createHash } from "crypto";
import { Cell, CellType, Dictionary, Slice, crc32c } from "@ton/core";
import type { TonUnprovenValidatorSet } from "./ton-lite-signature-proof";
import type { TonProvenMasterchainHeader } from "./ton-masterchain-header-proof";

const VALIDATORS_TAG = 0x11;
const VALIDATORS_EXT_TAG = 0x12;
const VALIDATOR_TAG = 0x53;
const VALIDATOR_ADDR_TAG = 0x73;
const ED25519_PUBLIC_KEY_TAG = 0x8e81278a;
const CATCHAIN_CONFIG_TAG = 0xc1;
const CATCHAIN_CONFIG_NEW_TAG = 0xc2;
const VALIDATOR_SET_HASH_MAGIC = 0x901660ed;
const MASTERCHAIN_SHARD = 1n << 63n;
const MASTERCHAIN_WORKCHAIN = -1;
const MAX_VALIDATOR_WEIGHT = 1n << 61n;
const ZERO_HASH = "0".repeat(64);
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface TonValidatorConfigDescriptor {
  index: number;
  publicKey: string;
  weight: string;
  adnlAddress: string;
}

export interface TonParsedValidatorSet {
  kind: "TON_PARSED_VALIDATOR_SET";
  sourceConfigProven: false;
  validatorSetProven: false;
  format: "validators" | "validators_ext";
  validSinceUnix: number;
  validUntilUnix: number;
  total: number;
  main: number;
  totalWeight: string;
  validators: readonly TonValidatorConfigDescriptor[];
  cellHash: string;
}

export interface TonCatchainValidatorsConfig {
  kind: "TON_PARSED_CATCHAIN_CONFIG";
  sourceConfigProven: false;
  format: "default" | "catchain_config" | "catchain_config_new";
  shuffleMasterchainValidators: boolean;
  masterchainCatchainLifetime: number;
  shardCatchainLifetime: number;
  shardValidatorsLifetime: number;
  shardValidatorsCount: number;
  cellHash: string | null;
}

export interface TonDerivedMasterchainValidatorSet {
  kind: "TON_DERIVED_MASTERCHAIN_VALIDATOR_SET";
  sourceConfigProven: false;
  selectionReproduced: true;
  validatorSetHashReproduced: true;
  validatorSetProven: false;
  finalityProven: false;
  catchainSeqno: number;
  validatorSetHash: number;
  shuffled: boolean;
  totalWeight: string;
  validators: readonly TonValidatorConfigDescriptor[];
  signatureValidatorSet: TonUnprovenValidatorSet;
}

export interface TonHeaderValidatorSetBinding {
  kind: "TON_HEADER_VALIDATOR_SET_BINDING";
  headerBindingVerified: true;
  sourceConfigProven: false;
  validatorSetProven: false;
  finalityProven: false;
  blockRootHash: string;
  catchainSeqno: number;
  validatorSetHash: number;
  validatorCount: number;
}

export class TonValidatorSetError extends Error {
  readonly name = "TonValidatorSetError";
}

function reject(message: string): never {
  throw new TonValidatorSetError(message);
}

function requireOrdinaryCell(cell: Cell, label: string): void {
  if (cell.type !== CellType.Ordinary) reject(`${label} must be ordinary`);
}

function requireUint32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    reject(`${label} is not uint32`);
  }
}

function parseValidatorDescriptor(
  source: Slice,
): Omit<TonValidatorConfigDescriptor, "index"> {
  try {
    const tag = source.loadUint(8);
    if (tag !== VALIDATOR_TAG && tag !== VALIDATOR_ADDR_TAG) {
      reject("validator descriptor has an unsupported tag");
    }
    if (source.loadUint(32) !== ED25519_PUBLIC_KEY_TAG) {
      reject("validator descriptor has an unsupported public key");
    }
    const publicKey = source.loadBuffer(32).toString("hex");
    const weight = source.loadUintBig(64);
    const adnlAddress =
      tag === VALIDATOR_ADDR_TAG
        ? source.loadBuffer(32).toString("hex")
        : ZERO_HASH;
    source.endParse();
    if (weight <= 0n || weight > MAX_VALIDATOR_WEIGHT) {
      reject("validator weight is out of range");
    }
    return { publicKey, weight: weight.toString(), adnlAddress };
  } catch (error) {
    if (error instanceof TonValidatorSetError) throw error;
    reject(
      `validator descriptor is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

const validatorValue = {
  serialize: () => {
    throw new Error("validator dictionary serialization is not supported");
  },
  parse: parseValidatorDescriptor,
};

function loadValidatorDictionary(
  source: Slice,
  extended: boolean,
): Dictionary<number, Omit<TonValidatorConfigDescriptor, "index">> {
  try {
    return extended
      ? Dictionary.load(Dictionary.Keys.Uint(16), validatorValue, source)
      : Dictionary.loadDirect(Dictionary.Keys.Uint(16), validatorValue, source);
  } catch (error) {
    if (error instanceof TonValidatorSetError) throw error;
    reject(
      `validator dictionary is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function parseTonValidatorSetCell(cell: Cell): TonParsedValidatorSet {
  requireOrdinaryCell(cell, "validator set cell");
  try {
    const source = cell.beginParse();
    const tag = source.loadUint(8);
    if (tag !== VALIDATORS_TAG && tag !== VALIDATORS_EXT_TAG) {
      reject("validator set has an unsupported tag");
    }
    const extended = tag === VALIDATORS_EXT_TAG;
    const validSinceUnix = source.loadUint(32);
    const validUntilUnix = source.loadUint(32);
    const total = source.loadUint(16);
    const main = source.loadUint(16);
    const declaredTotalWeight = extended ? source.loadUintBig(64) : null;
    if (validSinceUnix >= validUntilUnix) {
      reject("validator set validity interval is invalid");
    }
    if (total < 1 || main < 1 || main > total) {
      reject("validator set total/main counts are invalid");
    }
    if (declaredTotalWeight === 0n) {
      reject("validator set declares zero total weight");
    }
    const dictionary = loadValidatorDictionary(source, extended);
    source.endParse();
    if (dictionary.size !== total) {
      reject("validator dictionary size does not match total");
    }

    const validators: TonValidatorConfigDescriptor[] = [];
    const publicKeys = new Set<string>();
    let totalWeight = 0n;
    for (let index = 0; index < total; index += 1) {
      const descriptor = dictionary.get(index);
      if (!descriptor) reject("validator indices must be contiguous from zero");
      if (
        !HASH_PATTERN.test(descriptor.publicKey) ||
        publicKeys.has(descriptor.publicKey)
      ) {
        reject("validator public keys must be unique 256-bit values");
      }
      publicKeys.add(descriptor.publicKey);
      totalWeight += BigInt(descriptor.weight);
      if (totalWeight > MAX_VALIDATOR_WEIGHT) {
        reject("validator total weight exceeds the protocol cap");
      }
      validators.push({ index, ...descriptor });
    }
    if (declaredTotalWeight !== null && declaredTotalWeight !== totalWeight) {
      reject("validator set declares an incorrect total weight");
    }
    return {
      kind: "TON_PARSED_VALIDATOR_SET",
      sourceConfigProven: false,
      validatorSetProven: false,
      format: extended ? "validators_ext" : "validators",
      validSinceUnix,
      validUntilUnix,
      total,
      main,
      totalWeight: totalWeight.toString(),
      validators,
      cellHash: cell.hash().toString("hex"),
    };
  } catch (error) {
    if (error instanceof TonValidatorSetError) throw error;
    reject(
      `validator set cell is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function parseTonCatchainConfigCell(
  cell: Cell | null,
): TonCatchainValidatorsConfig {
  if (cell === null) {
    return {
      kind: "TON_PARSED_CATCHAIN_CONFIG",
      sourceConfigProven: false,
      format: "default",
      shuffleMasterchainValidators: false,
      masterchainCatchainLifetime: 200,
      shardCatchainLifetime: 200,
      shardValidatorsLifetime: 3000,
      shardValidatorsCount: 7,
      cellHash: null,
    };
  }
  requireOrdinaryCell(cell, "catchain config cell");
  try {
    const source = cell.beginParse();
    const tag = source.loadUint(8);
    let shuffleMasterchainValidators = false;
    let format: TonCatchainValidatorsConfig["format"];
    if (tag === CATCHAIN_CONFIG_TAG) {
      format = "catchain_config";
    } else if (tag === CATCHAIN_CONFIG_NEW_TAG) {
      format = "catchain_config_new";
      if (source.loadUint(7) !== 0) reject("catchain config flags are nonzero");
      shuffleMasterchainValidators = source.loadBoolean();
    } else {
      reject("catchain config has an unsupported tag");
    }
    const masterchainCatchainLifetime = source.loadUint(32);
    const shardCatchainLifetime = source.loadUint(32);
    const shardValidatorsLifetime = source.loadUint(32);
    const shardValidatorsCount = source.loadUint(32);
    source.endParse();
    if (
      masterchainCatchainLifetime < 1 ||
      shardCatchainLifetime < 1 ||
      shardValidatorsLifetime < 1 ||
      shardValidatorsCount < 1
    ) {
      reject("catchain config contains a zero required value");
    }
    return {
      kind: "TON_PARSED_CATCHAIN_CONFIG",
      sourceConfigProven: false,
      format,
      shuffleMasterchainValidators,
      masterchainCatchainLifetime,
      shardCatchainLifetime,
      shardValidatorsLifetime,
      shardValidatorsCount,
      cellHash: cell.hash().toString("hex"),
    };
  } catch (error) {
    if (error instanceof TonValidatorSetError) throw error;
    reject(
      `catchain config cell is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

class MasterchainValidatorPrng {
  private readonly seed = Buffer.alloc(32);
  private readonly suffix: Buffer;
  private hash = Buffer.alloc(0);
  private position = 8;

  constructor(catchainSeqno: number) {
    requireUint32(catchainSeqno, "catchainSeqno");
    this.suffix = Buffer.alloc(16);
    this.suffix.writeBigUInt64BE(MASTERCHAIN_SHARD, 0);
    this.suffix.writeInt32BE(MASTERCHAIN_WORKCHAIN, 8);
    this.suffix.writeUInt32BE(catchainSeqno, 12);
  }

  private incrementSeed(): void {
    for (let index = this.seed.length - 1; index >= 0; index -= 1) {
      this.seed[index] = (this.seed[index] + 1) & 0xff;
      if (this.seed[index] !== 0) return;
    }
  }

  nextUint64(): bigint {
    if (this.position >= 8) {
      this.hash = createHash("sha512")
        .update(this.seed)
        .update(this.suffix)
        .digest();
      this.incrementSeed();
      this.position = 0;
    }
    const result = this.hash.readBigUInt64BE(this.position * 8);
    this.position += 1;
    return result;
  }

  nextRanged(range: bigint): bigint {
    if (range <= 0n || range > (1n << 64n) - 1n) {
      reject("PRNG range is invalid");
    }
    return (range * this.nextUint64()) >> 64n;
  }
}

function selectMasterchainValidators(
  validatorSet: TonParsedValidatorSet,
  catchainSeqno: number,
  shuffle: boolean,
): TonValidatorConfigDescriptor[] {
  const selected = validatorSet.validators.slice(0, validatorSet.main);
  if (!shuffle) return selected.map((item) => ({ ...item }));
  const indices = new Array<number>(selected.length);
  const prng = new MasterchainValidatorPrng(catchainSeqno);
  for (let index = 0; index < selected.length; index += 1) {
    const swap = Number(prng.nextRanged(BigInt(index + 1)));
    indices[index] = indices[swap];
    indices[swap] = index;
  }
  return indices.map((index) => ({ ...selected[index] }));
}

function uint32Le(value: number): Buffer {
  const result = Buffer.allocUnsafe(4);
  result.writeUInt32LE(value >>> 0);
  return result;
}

function uint64Le(value: bigint): Buffer {
  const result = Buffer.allocUnsafe(8);
  result.writeBigUInt64LE(value);
  return result;
}

export function computeTonValidatorSetHash(
  catchainSeqno: number,
  validators: readonly Pick<
    TonValidatorConfigDescriptor,
    "publicKey" | "weight" | "adnlAddress"
  >[],
): number {
  requireUint32(catchainSeqno, "catchainSeqno");
  if (validators.length === 0 || validators.length > 0xffffffff) {
    reject("validator hash input count is invalid");
  }
  const parts = [
    uint32Le(VALIDATOR_SET_HASH_MAGIC),
    uint32Le(catchainSeqno),
    uint32Le(validators.length),
  ];
  for (let index = 0; index < validators.length; index += 1) {
    const validator = validators[index];
    if (
      !HASH_PATTERN.test(validator.publicKey) ||
      !HASH_PATTERN.test(validator.adnlAddress)
    ) {
      reject(`validator hash input ${index} has an invalid identity`);
    }
    if (!/^[1-9][0-9]*$/.test(validator.weight)) {
      reject(`validator hash input ${index} has a non-canonical weight`);
    }
    const weight = BigInt(validator.weight);
    if (weight <= 0n || weight > MAX_VALIDATOR_WEIGHT) {
      reject(`validator hash input ${index} has an invalid weight`);
    }
    parts.push(
      Buffer.from(validator.publicKey, "hex"),
      uint64Le(weight),
      Buffer.from(validator.adnlAddress, "hex"),
    );
  }
  return crc32c(Buffer.concat(parts)).readUInt32LE(0);
}

export function deriveTonMasterchainValidatorSet(
  validatorSet: TonParsedValidatorSet,
  catchainConfig: TonCatchainValidatorsConfig,
  catchainSeqno: number,
): TonDerivedMasterchainValidatorSet {
  requireUint32(catchainSeqno, "catchainSeqno");
  if (
    validatorSet.sourceConfigProven !== false ||
    validatorSet.validatorSetProven !== false ||
    catchainConfig.sourceConfigProven !== false
  ) {
    reject("unexpected validator provenance flags");
  }
  const validators = selectMasterchainValidators(
    validatorSet,
    catchainSeqno,
    catchainConfig.shuffleMasterchainValidators,
  );
  let totalWeight = 0n;
  for (const validator of validators) totalWeight += BigInt(validator.weight);
  const validatorSetHash = computeTonValidatorSetHash(
    catchainSeqno,
    validators,
  );
  return {
    kind: "TON_DERIVED_MASTERCHAIN_VALIDATOR_SET",
    sourceConfigProven: false,
    selectionReproduced: true,
    validatorSetHashReproduced: true,
    validatorSetProven: false,
    finalityProven: false,
    catchainSeqno,
    validatorSetHash,
    shuffled: catchainConfig.shuffleMasterchainValidators,
    totalWeight: totalWeight.toString(),
    validators,
    signatureValidatorSet: {
      catchainSeqno,
      validatorSetHash,
      validators: validators.map((validator) => ({
        publicKey: validator.publicKey,
        weight: validator.weight,
      })),
    },
  };
}

export function bindTonMasterchainHeaderValidatorSet(
  header: TonProvenMasterchainHeader,
  validatorSet: TonDerivedMasterchainValidatorSet,
): TonHeaderValidatorSetBinding {
  if (
    header.rootHashVerified !== true ||
    header.signaturesVerified !== false ||
    header.finalityProven !== false
  ) {
    reject("unexpected masterchain header provenance flags");
  }
  if (
    validatorSet.sourceConfigProven !== false ||
    validatorSet.validatorSetProven !== false ||
    validatorSet.finalityProven !== false
  ) {
    reject("unexpected validator-set provenance flags");
  }
  if (header.catchainSeqno !== validatorSet.catchainSeqno) {
    reject("masterchain header catchain sequence does not match validator set");
  }
  if (header.validatorListHashShort !== validatorSet.validatorSetHash) {
    reject(
      "masterchain header validator-list hash does not match validator set",
    );
  }
  return {
    kind: "TON_HEADER_VALIDATOR_SET_BINDING",
    headerBindingVerified: true,
    sourceConfigProven: false,
    validatorSetProven: false,
    finalityProven: false,
    blockRootHash: header.block.rootHash,
    catchainSeqno: validatorSet.catchainSeqno,
    validatorSetHash: validatorSet.validatorSetHash,
    validatorCount: validatorSet.validators.length,
  };
}
