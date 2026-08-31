import {
  beginCell,
  Builder,
  Cell,
  convertToMerkleProof,
  Dictionary,
  generateMerkleProofDirect,
  Slice,
  storeShardIdent,
} from "@ton/core";
import { keyPairFromSeed, sign } from "@ton/crypto";
import type { TonLiteBlockLinkForward } from "./ton-lite-signature-proof";
import {
  tonNodeIdShort,
  tonOrdinaryBlockSignedData,
  tonSimplexBlockSignedData,
} from "./ton-lite-signature-proof";
import type { TonProofBlockId } from "./ton-proof-envelope";
import {
  lookupTonConfigParameter,
  TonForwardLinkProofError,
  verifyTonForwardKeyBlockLink,
} from "./ton-forward-link-proof";
import {
  deriveTonMasterchainValidatorSet,
  parseTonCatchainConfigCell,
  parseTonValidatorSetCell,
} from "./ton-validator-set";

const GLOBAL_ID = -3;
const MC_SHARD = "-9223372036854775808";
const limits = { maxBocBytes: 1_000_000, maxCells: 10_000, maxDepth: 256 };

interface ValidatorFixture {
  publicKey: Buffer;
  secretKey: Buffer;
  weight: bigint;
}

const validatorCodec = {
  serialize(src: ValidatorFixture, builder: Builder): void {
    builder
      .storeUint(0x73, 8)
      .storeUint(0x8e81278a, 32)
      .storeBuffer(src.publicKey)
      .storeUint(src.weight, 64)
      .storeBuffer(src.publicKey);
  },
  parse(_source: Slice): ValidatorFixture {
    throw new Error("write-only test codec");
  },
};

function validators(seedOffset = 0): ValidatorFixture[] {
  return [40n, 30n, 30n].map((weight, index) => {
    const pair = keyPairFromSeed(Buffer.alloc(32, seedOffset + index + 1));
    return { ...pair, weight };
  });
}

function validatorSetCell(items: ValidatorFixture[]): Cell {
  const dictionary = Dictionary.empty(Dictionary.Keys.Uint(16), validatorCodec);
  items.forEach((validator, index) => dictionary.set(index, validator));
  return beginCell()
    .storeUint(0x12, 8)
    .storeUint(1, 32)
    .storeUint(0xffffffff, 32)
    .storeUint(items.length, 16)
    .storeUint(items.length, 16)
    .storeUint(100n, 64)
    .storeDict(dictionary)
    .endCell();
}

function catchainCell(shuffle = false): Cell {
  return beginCell()
    .storeUint(0xc2, 8)
    .storeUint(0, 7)
    .storeBit(shuffle)
    .storeUint(200, 32)
    .storeUint(200, 32)
    .storeUint(3000, 32)
    .storeUint(7, 32)
    .endCell();
}

function configDictionary(params: ReadonlyMap<number, Cell>) {
  const dictionary = Dictionary.empty(
    Dictionary.Keys.Uint(32),
    Dictionary.Values.Cell(),
  );
  for (const [key, value] of params) dictionary.set(key, value);
  return dictionary;
}

function configRoot(dictionary: Dictionary<number, Cell>): Cell {
  return beginCell().storeDictDirect(dictionary).endCell();
}

function extBlockRef(seqno: number): Cell {
  return beginCell()
    .storeUint(900n, 64)
    .storeUint(seqno, 32)
    .storeBuffer(Buffer.alloc(32, 0xa1))
    .storeBuffer(Buffer.alloc(32, 0xa2))
    .endCell();
}

function blockInfo(input: {
  seqno: number;
  previousKeyBlockSeqno: number;
  validatorSetHash: number;
  catchainSeqno: number;
  keyBlock: boolean;
  wantSplit?: boolean;
  wantMerge?: boolean;
}): Cell {
  return beginCell()
    .storeUint(0x9bc7a987, 32)
    .storeUint(0, 32)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(input.wantSplit ?? false)
    .storeBit(input.wantMerge ?? false)
    .storeBit(input.keyBlock)
    .storeBit(false)
    .storeUint(0, 8)
    .storeUint(input.seqno, 32)
    .storeUint(0, 32)
    .store(
      storeShardIdent({
        shardPrefixBits: 0,
        workchainId: -1,
        shardPrefix: 0n,
      }),
    )
    .storeUint(1_800_000_000 + input.seqno, 32)
    .storeUint(1_000n, 64)
    .storeUint(2_000n, 64)
    .storeUint(input.validatorSetHash, 32)
    .storeUint(input.catchainSeqno, 32)
    .storeUint(input.previousKeyBlockSeqno, 32)
    .storeUint(input.previousKeyBlockSeqno, 32)
    .storeRef(extBlockRef(input.seqno - 1))
    .endCell();
}

function keyBlockExtra(root: Cell): Cell {
  const dummy = beginCell().storeBit(false).endCell();
  const masterchainExtra = beginCell()
    .storeUint(0xcca5, 16)
    .storeBit(true)
    .storeBit(false)
    .storeBit(false)
    .storeCoins(0)
    .storeBit(false)
    .storeCoins(0)
    .storeBit(false)
    .storeRef(dummy)
    .storeBuffer(Buffer.alloc(32, 0xc1))
    .storeRef(root)
    .endCell();
  return beginCell()
    .storeUint(0x4a33f6fd, 32)
    .storeRef(dummy)
    .storeRef(dummy)
    .storeRef(dummy)
    .storeBuffer(Buffer.alloc(32, 0xd1))
    .storeBuffer(Buffer.alloc(32, 0xd2))
    .storeBit(true)
    .storeRef(masterchainExtra)
    .endCell();
}

function block(info: Cell, extra: Cell): Cell {
  const dummy = beginCell().storeBit(false).endCell();
  return beginCell()
    .storeUint(0x11ef55aa, 32)
    .storeInt(GLOBAL_ID, 32)
    .storeRef(info)
    .storeRef(dummy)
    .storeRef(dummy)
    .storeRef(extra)
    .endCell();
}

interface FixtureOptions {
  includeCatchain?: boolean;
  includeTemporaryValidators?: boolean;
  prunedConfigRoot?: Cell;
  destinationKeyBlock?: boolean;
  toKeyBlock?: boolean;
  signerIndexes?: number[];
  wrongDestinationValidatorHash?: boolean;
  simplex?: boolean;
  wantSplit?: boolean;
  wantMerge?: boolean;
}

function u32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32LE(value >>> 0);
  return result;
}

function i32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeInt32LE(value);
  return result;
}

function u64(value: bigint): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(value);
  return result;
}

function simplexCandidate(value: TonProofBlockId): Buffer {
  return Buffer.concat([
    u32(0xe8f9bcdc),
    i32(value.workchain),
    u64(BigInt.asUintN(64, BigInt(value.shard))),
    u32(value.seqno),
    Buffer.from(value.rootHash, "hex"),
    Buffer.from(value.fileHash, "hex"),
    Buffer.alloc(32, 0x55),
    u32(0x22cbcca9),
  ]);
}

function fixture(options: FixtureOptions = {}) {
  const current = validators();
  const temporary = validators(10);
  const currentCell = validatorSetCell(current);
  const temporaryCell = validatorSetCell(temporary);
  const params = new Map<number, Cell>([[34, currentCell]]);
  if (options.includeCatchain !== false) params.set(28, catchainCell());
  if (options.includeTemporaryValidators) params.set(35, temporaryCell);
  const dictionary = configDictionary(params);
  const fullConfigRoot = configRoot(dictionary);
  const proofConfigRoot = options.prunedConfigRoot ?? fullConfigRoot;
  const selectedCell = options.includeTemporaryValidators
    ? temporaryCell
    : currentCell;
  const selectedValidators = options.includeTemporaryValidators
    ? temporary
    : current;
  const catchain = parseTonCatchainConfigCell(params.get(28) ?? null);
  const derived = deriveTonMasterchainValidatorSet(
    parseTonValidatorSetCell(selectedCell),
    catchain,
    7,
  );

  const sourceSeqno = 100;
  const sourceBlock = block(
    blockInfo({
      seqno: sourceSeqno,
      previousKeyBlockSeqno: 90,
      validatorSetHash: 0,
      catchainSeqno: 6,
      keyBlock: true,
      wantSplit: options.wantSplit,
      wantMerge: options.wantMerge,
    }),
    keyBlockExtra(proofConfigRoot),
  );
  const destinationKeyBlock = options.destinationKeyBlock ?? false;
  const destinationBlock = block(
    blockInfo({
      seqno: 101,
      previousKeyBlockSeqno: sourceSeqno,
      validatorSetHash: options.wrongDestinationValidatorHash
        ? (derived.validatorSetHash ^ 1) >>> 0
        : derived.validatorSetHash,
      catchainSeqno: 7,
      keyBlock: destinationKeyBlock,
      wantSplit: options.wantSplit,
      wantMerge: options.wantMerge,
    }),
    beginCell().storeBit(false).endCell(),
  );
  const from: TonProofBlockId = {
    workchain: -1,
    shard: MC_SHARD,
    seqno: sourceSeqno,
    rootHash: sourceBlock.hash(0).toString("hex"),
    fileHash: "a".repeat(64),
  };
  const to: TonProofBlockId = {
    workchain: -1,
    shard: MC_SHARD,
    seqno: 101,
    rootHash: destinationBlock.hash(0).toString("hex"),
    fileHash: "b".repeat(64),
  };
  const signerIndexes = options.signerIndexes ?? [0, 1];
  const link: TonLiteBlockLinkForward = {
    kind: "forward",
    toKeyBlock: options.toKeyBlock ?? destinationKeyBlock,
    from,
    to,
    configProof: convertToMerkleProof(sourceBlock).toBoc({
      idx: false,
      crc32: false,
    }),
    destProof: convertToMerkleProof(destinationBlock).toBoc({
      idx: false,
      crc32: false,
    }),
    signatures: {
      ...(options.simplex
        ? {
            kind: "simplex" as const,
            sessionId: Buffer.alloc(32, 0x66),
            slot: 23,
            candidate: simplexCandidate(to),
          }
        : { kind: "ordinary" as const }),
      catchainSeqno: 7,
      validatorSetHash: derived.validatorSetHash,
      signatures: [],
    },
  };
  const signedData = options.simplex
    ? tonSimplexBlockSignedData(link)
    : tonOrdinaryBlockSignedData(to);
  link.signatures.signatures = signerIndexes.map((index) => ({
    nodeIdShort: tonNodeIdShort(selectedValidators[index].publicKey).toString(
      "hex",
    ),
    signature: sign(signedData, selectedValidators[index].secretKey),
  }));
  return {
    link,
    expectation: {
      globalId: GLOBAL_ID,
      trustedSourceKeyBlock: { ...from },
      limits,
    },
    dictionary,
    fullConfigRoot,
  };
}

describe("authenticated TON configuration dictionary lookup", () => {
  it("distinguishes present and proven-absent parameters", () => {
    const root = configRoot(
      configDictionary(
        new Map([
          [28, catchainCell()],
          [34, validatorSetCell(validators())],
        ]),
      ),
    );
    expect(lookupTonConfigParameter(root, 28).status).toBe("present");
    expect(lookupTonConfigParameter(root, 35)).toEqual({ status: "absent" });
  });

  it("does not confuse a pruned target path with authenticated absence", () => {
    const dictionary = configDictionary(
      new Map([
        [28, catchainCell()],
        [34, validatorSetCell(validators())],
      ]),
    );
    const pruned = generateMerkleProofDirect(
      dictionary,
      [34],
      Dictionary.Keys.Uint(32),
    );
    expect(lookupTonConfigParameter(pruned, 28)).toEqual({
      status: "unproven",
    });
    expect(lookupTonConfigParameter(pruned, 34).status).toBe("present");
  });

  it("rejects an exotic dictionary root and an invalid parameter index", () => {
    expect(() =>
      lookupTonConfigParameter(
        convertToMerkleProof(beginCell().storeBit(false).endCell()),
        28,
      ),
    ).toThrow("non-ordinary");
    expect(() => lookupTonConfigParameter(beginCell().endCell(), -1)).toThrow(
      "outside int32",
    );
  });
});

describe("TON forward key-block link proof", () => {
  it("authenticates source config, destination header, validator set, and signatures", () => {
    const { link, expectation } = fixture();
    expect(verifyTonForwardKeyBlockLink(link, expectation)).toMatchObject({
      kind: "TON_VERIFIED_FORWARD_KEY_BLOCK_LINK",
      configProofVerified: true,
      destinationProofVerified: true,
      sourceConfigProven: true,
      validatorSetProven: true,
      headerBindingVerified: true,
      signaturesVerified: true,
      thresholdVerified: true,
      consensus: "ordinary",
      linkVerified: true,
      finalityProven: false,
      validatorParameter: 34,
      catchainParameter: "present",
      catchainSeqno: 7,
      validatorCount: 3,
      signedWeight: "70",
      totalWeight: "100",
      signerCount: 2,
    });
  });

  it("authenticates a finalized Simplex signature set against the same proven validator configuration", () => {
    const { link, expectation } = fixture({ simplex: true });
    expect(verifyTonForwardKeyBlockLink(link, expectation)).toMatchObject({
      consensus: "simplex",
      signaturesVerified: true,
      thresholdVerified: true,
      validatorSetProven: true,
      signedWeight: "70",
      totalWeight: "100",
      signerCount: 2,
    });
  });

  it("allows advisory split and merge intent bits on signed masterchain headers", () => {
    const { link, expectation } = fixture({
      wantSplit: true,
      wantMerge: true,
    });
    expect(verifyTonForwardKeyBlockLink(link, expectation)).toMatchObject({
      headerBindingVerified: true,
      signaturesVerified: true,
      linkVerified: true,
    });
  });

  it("uses parameter 35 before 34 exactly like the reference implementation", () => {
    const { link, expectation } = fixture({
      includeTemporaryValidators: true,
    });
    expect(verifyTonForwardKeyBlockLink(link, expectation)).toMatchObject({
      validatorParameter: 35,
      validatorSetProven: true,
    });
  });

  it("uses catchain defaults only when parameter 28 is proven absent", () => {
    const { link, expectation } = fixture({ includeCatchain: false });
    expect(verifyTonForwardKeyBlockLink(link, expectation)).toMatchObject({
      catchainParameter: "proven-absent-default",
    });
  });

  it("rejects config parameters hidden behind a pruned branch", () => {
    const base = fixture();
    const pruned = generateMerkleProofDirect(
      base.dictionary,
      [34],
      Dictionary.Keys.Uint(32),
    );
    const { link, expectation } = fixture({ prunedConfigRoot: pruned });
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "parameter 28 is hidden",
    );
  });

  it("rejects a source checkpoint substitution", () => {
    const { link, expectation } = fixture();
    expectation.trustedSourceKeyBlock.fileHash = "c".repeat(64);
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "trusted key block",
    );
  });

  it("rejects a destination proof or destination root substitution", () => {
    const { link, expectation } = fixture();
    link.destProof = Buffer.from(link.configProof);
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "dest_proof does not authenticate",
    );
    const second = fixture();
    second.link.to.rootHash = "e".repeat(64);
    expect(() =>
      verifyTonForwardKeyBlockLink(second.link, second.expectation),
    ).toThrow("dest_proof does not authenticate");
  });

  it("rejects trailing proof bytes under the shared strict BOC policy", () => {
    const { link, expectation } = fixture();
    link.configProof = Buffer.concat([link.configProof, Buffer.from([0])]);
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "trailing or missing bytes",
    );
  });

  it("rejects disagreement between toKeyBlock and the proven header", () => {
    const { link, expectation } = fixture({ toKeyBlock: true });
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "toKeyBlock",
    );
  });

  it("rejects insufficient signature weight after every proof check", () => {
    const { link, expectation } = fixture({ signerIndexes: [0] });
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "two thirds",
    );
  });

  it("rejects a header validator hash not derived from authenticated config", () => {
    const { link, expectation } = fixture({
      wrongDestinationValidatorHash: true,
    });
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "destination validator-list hash",
    );
  });

  it("rejects signature-set metadata that disagrees with the derived set", () => {
    const { link, expectation } = fixture();
    link.signatures.validatorSetHash =
      (link.signatures.validatorSetHash ^ 1) >>> 0;
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      "validator set hash mismatch",
    );
  });

  it("uses a dedicated proof error for link-shape failures", () => {
    const { link, expectation } = fixture();
    link.to.seqno = link.from.seqno;
    expect(() => verifyTonForwardKeyBlockLink(link, expectation)).toThrow(
      TonForwardLinkProofError,
    );
  });
});
