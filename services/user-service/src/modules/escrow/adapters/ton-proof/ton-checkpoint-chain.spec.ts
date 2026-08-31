import {
  beginCell,
  Builder,
  Cell,
  convertToMerkleProof,
  Dictionary,
  Slice,
  storeShardIdent,
} from "@ton/core";
import { keyPairFromSeed, sign } from "@ton/crypto";
import type {
  TonLiteBlockLinkForward,
  TonLiteSignature,
} from "./ton-lite-signature-proof";
import {
  tonNodeIdShort,
  tonOrdinaryBlockSignedData,
  tonSimplexBlockSignedData,
} from "./ton-lite-signature-proof";
import type { TonProofBlockId } from "./ton-proof-envelope";
import {
  TonCheckpointChainError,
  verifyTonMasterchainCheckpointChain,
} from "./ton-checkpoint-chain";
import {
  deriveTonMasterchainValidatorSet,
  parseTonCatchainConfigCell,
  parseTonValidatorSetCell,
} from "./ton-validator-set";

const IDS = {
  partial: 0x8ed0d2c1,
  back: 0xef7e1bef,
  forward: 0x520fce1c,
  ordinary: 0xf644a6e6,
  simplex: 0xac249800,
  boolTrue: 0x997275b5,
  boolFalse: 0xbc799737,
};
const GLOBAL_ID = -3;
const MC_SHARD = "-9223372036854775808";

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

function validatorFixtures(offset: number): ValidatorFixture[] {
  return [70n, 30n].map((weight, index) => ({
    ...keyPairFromSeed(Buffer.alloc(32, offset + index + 1)),
    weight,
  }));
}

function validatorSetCell(items: ValidatorFixture[]): Cell {
  const dictionary = Dictionary.empty(Dictionary.Keys.Uint(16), validatorCodec);
  items.forEach((item, index) => dictionary.set(index, item));
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

function catchainCell(): Cell {
  return beginCell()
    .storeUint(0xc2, 8)
    .storeUint(0, 7)
    .storeBit(false)
    .storeUint(200, 32)
    .storeUint(200, 32)
    .storeUint(3000, 32)
    .storeUint(7, 32)
    .endCell();
}

function config(offset: number, catchainSeqno: number) {
  const validators = validatorFixtures(offset);
  const validatorCell = validatorSetCell(validators);
  const catchain = catchainCell();
  const dictionary = Dictionary.empty(
    Dictionary.Keys.Uint(32),
    Dictionary.Values.Cell(),
  );
  dictionary.set(28, catchain);
  dictionary.set(34, validatorCell);
  const root = beginCell().storeDictDirect(dictionary).endCell();
  const derived = deriveTonMasterchainValidatorSet(
    parseTonValidatorSetCell(validatorCell),
    parseTonCatchainConfigCell(catchain),
    catchainSeqno,
  );
  return { validators, root, derived };
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
  generatedAtUnix: number;
}): Cell {
  return beginCell()
    .storeUint(0x9bc7a987, 32)
    .storeUint(0, 32)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
    .storeBit(false)
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
    .storeUint(input.generatedAtUnix, 32)
    .storeUint(1_000n, 64)
    .storeUint(2_000n, 64)
    .storeUint(input.validatorSetHash, 32)
    .storeUint(input.catchainSeqno, 32)
    .storeUint(input.previousKeyBlockSeqno, 32)
    .storeUint(input.previousKeyBlockSeqno, 32)
    .storeRef(extBlockRef(input.seqno - 1))
    .endCell();
}

function keyBlockExtra(configRoot: Cell): Cell {
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
    .storeRef(configRoot)
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

function blockId(cell: Cell, seqno: number, marker: number): TonProofBlockId {
  return {
    workchain: -1,
    shard: MC_SHARD,
    seqno,
    rootHash: cell.hash(0).toString("hex"),
    fileHash: marker.toString(16).padStart(64, "0"),
  };
}

function forwardLink(
  sourceCell: Cell,
  source: TonProofBlockId,
  destinationCell: Cell,
  destination: TonProofBlockId,
  destinationIsKeyBlock: boolean,
  sourceConfig: ReturnType<typeof config>,
  simplex = false,
): TonLiteBlockLinkForward {
  const link: TonLiteBlockLinkForward = {
    kind: "forward",
    toKeyBlock: destinationIsKeyBlock,
    from: source,
    to: destination,
    configProof: convertToMerkleProof(sourceCell).toBoc({
      idx: false,
      crc32: false,
    }),
    destProof: convertToMerkleProof(destinationCell).toBoc({
      idx: false,
      crc32: false,
    }),
    signatures: {
      ...(simplex
        ? {
            kind: "simplex" as const,
            sessionId: Buffer.alloc(32, 0x66),
            slot: 23,
            candidate: Buffer.concat([
              u32(0xe8f9bcdc),
              blockBytes(destination),
              Buffer.alloc(32, 0x55),
              u32(0x22cbcca9),
            ]),
          }
        : { kind: "ordinary" as const }),
      validatorSetHash: sourceConfig.derived.validatorSetHash,
      catchainSeqno: sourceConfig.derived.catchainSeqno,
      signatures: [],
    },
  };
  const signedData = simplex
    ? tonSimplexBlockSignedData(link)
    : tonOrdinaryBlockSignedData(destination);
  link.signatures.signatures = [
    {
      nodeIdShort: tonNodeIdShort(
        sourceConfig.validators[0].publicKey,
      ).toString("hex"),
      signature: sign(signedData, sourceConfig.validators[0].secretKey),
    },
  ];
  return link;
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

function tlBytes(value: Buffer): Buffer {
  const prefix =
    value.length < 254
      ? Buffer.from([value.length])
      : Buffer.from([
          254,
          value.length & 0xff,
          (value.length >> 8) & 0xff,
          (value.length >> 16) & 0xff,
        ]);
  return Buffer.concat([
    prefix,
    value,
    Buffer.alloc((4 - ((prefix.length + value.length) % 4)) % 4),
  ]);
}

function vector(values: readonly Buffer[]): Buffer {
  return Buffer.concat([u32(values.length), ...values]);
}

function blockBytes(value: TonProofBlockId): Buffer {
  return Buffer.concat([
    i32(value.workchain),
    u64(BigInt.asUintN(64, BigInt(value.shard))),
    u32(value.seqno),
    Buffer.from(value.rootHash, "hex"),
    Buffer.from(value.fileHash, "hex"),
  ]);
}

function signatureBytes(value: TonLiteSignature): Buffer {
  return Buffer.concat([
    Buffer.from(value.nodeIdShort, "hex"),
    tlBytes(value.signature),
  ]);
}

function forwardBytes(link: TonLiteBlockLinkForward): Buffer {
  const prefix = [
    u32(IDS.forward),
    u32(link.toKeyBlock ? IDS.boolTrue : IDS.boolFalse),
    blockBytes(link.from),
    blockBytes(link.to),
    tlBytes(link.destProof),
    tlBytes(link.configProof),
  ];
  if (link.signatures.kind === "ordinary") {
    return Buffer.concat([
      ...prefix,
      u32(IDS.ordinary),
      u32(link.signatures.validatorSetHash),
      u32(link.signatures.catchainSeqno),
      vector(link.signatures.signatures.map(signatureBytes)),
    ]);
  }
  return Buffer.concat([
    ...prefix,
    u32(IDS.simplex),
    u32(link.signatures.catchainSeqno),
    u32(link.signatures.validatorSetHash),
    vector(link.signatures.signatures.map(signatureBytes)),
    link.signatures.sessionId,
    u32(link.signatures.slot),
    tlBytes(link.signatures.candidate),
  ]);
}

function backBytes(from: TonProofBlockId, to: TonProofBlockId): Buffer {
  return Buffer.concat([
    u32(IDS.back),
    u32(IDS.boolFalse),
    blockBytes(from),
    blockBytes(to),
    tlBytes(Buffer.from([1])),
    tlBytes(Buffer.from([2])),
    tlBytes(Buffer.from([3])),
  ]);
}

function partialBytes(
  complete: boolean,
  from: TonProofBlockId,
  to: TonProofBlockId,
  steps: readonly Buffer[],
): string {
  return Buffer.concat([
    u32(IDS.partial),
    u32(complete ? IDS.boolTrue : IDS.boolFalse),
    blockBytes(from),
    blockBytes(to),
    vector(steps),
  ]).toString("base64");
}

function fixture(intermediateIsKeyBlock = true, simplex = false) {
  const firstConfig = config(0, 7);
  const secondConfig = config(10, 8);
  const source = block(
    blockInfo({
      seqno: 100,
      previousKeyBlockSeqno: 90,
      validatorSetHash: 0,
      catchainSeqno: 6,
      keyBlock: true,
      generatedAtUnix: 1_800_000_000,
    }),
    keyBlockExtra(firstConfig.root),
  );
  const intermediate = block(
    blockInfo({
      seqno: 110,
      previousKeyBlockSeqno: 100,
      validatorSetHash: firstConfig.derived.validatorSetHash,
      catchainSeqno: 7,
      keyBlock: intermediateIsKeyBlock,
      generatedAtUnix: 1_800_000_100,
    }),
    keyBlockExtra(secondConfig.root),
  );
  const target = block(
    blockInfo({
      seqno: 115,
      previousKeyBlockSeqno: 110,
      validatorSetHash: secondConfig.derived.validatorSetHash,
      catchainSeqno: 8,
      keyBlock: false,
      generatedAtUnix: 1_800_000_200,
    }),
    beginCell().storeBit(false).endCell(),
  );
  const sourceId = blockId(source, 100, 1);
  const intermediateId = blockId(intermediate, 110, 2);
  const targetId = blockId(target, 115, 3);
  const first = forwardLink(
    source,
    sourceId,
    intermediate,
    intermediateId,
    intermediateIsKeyBlock,
    firstConfig,
    simplex,
  );
  const second = forwardLink(
    intermediate,
    intermediateId,
    target,
    targetId,
    false,
    secondConfig,
    simplex,
  );
  const raw = partialBytes(true, sourceId, targetId, [
    forwardBytes(first),
    forwardBytes(second),
  ]);
  const expectation = {
    policyVersion: "test-policy-v1",
    globalId: GLOBAL_ID,
    trustedKeyBlock: { ...sourceId },
    targetBlock: { ...targetId },
    observedAtUnix: 1_800_000_210,
    nowUnix: 1_800_000_220,
    maxProofAgeSeconds: 300,
    maxFutureSkewSeconds: 10,
    liteLimits: {
      maxBytes: 1_000_000,
      maxLinks: 16,
      maxSignaturesPerLink: 100,
      maxEmbeddedProofBytes: 250_000,
    },
    bocLimits: { maxBocBytes: 250_000, maxCells: 10_000, maxDepth: 256 },
  };
  return {
    raw,
    expectation,
    sourceId,
    intermediateId,
    targetId,
    first,
    second,
  };
}

describe("TON masterchain checkpoint chain", () => {
  it("proves a complete two-link ordinary chain from the trusted key block", () => {
    const { raw, expectation, intermediateId } = fixture();
    const result = verifyTonMasterchainCheckpointChain(raw, expectation);
    expect(result).toMatchObject({
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
      linkCount: 2,
      latestKeyBlock: intermediateId,
    });
    expect(result.checkpointEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.links.every((link) => link.finalityProven === false)).toBe(
      true,
    );
  });

  it("proves a complete two-link finalized Simplex chain", () => {
    const { raw, expectation } = fixture(true, true);
    expect(verifyTonMasterchainCheckpointChain(raw, expectation)).toMatchObject({
      supportedConsensusVerified: true,
      ordinaryConsensusVerified: false,
      simplexConsensusVerified: true,
      masterchainFinalityProven: true,
      finalityProven: true,
      linkCount: 2,
      links: [{ consensus: "simplex" }, { consensus: "simplex" }],
    });
  });

  it("produces deterministic evidence for identical raw proof and policy", () => {
    const { raw, expectation } = fixture();
    const first = verifyTonMasterchainCheckpointChain(raw, expectation);
    const second = verifyTonMasterchainCheckpointChain(raw, expectation);
    expect(first.checkpointEvidenceHash).toBe(second.checkpointEvidenceHash);
    expect(first.rawProofHash).toBe(second.rawProofHash);
  });

  it("rejects an incomplete partialBlockProof", () => {
    const { expectation, sourceId, targetId, first, second } = fixture();
    const raw = partialBytes(false, sourceId, targetId, [
      forwardBytes(first),
      forwardBytes(second),
    ]);
    expect(() => verifyTonMasterchainCheckpointChain(raw, expectation)).toThrow(
      "incomplete",
    );
  });

  it("rejects a path whose origin or destination differs from policy", () => {
    const { raw, expectation } = fixture();
    expectation.trustedKeyBlock.fileHash = "f".repeat(64);
    expect(() => verifyTonMasterchainCheckpointChain(raw, expectation)).toThrow(
      "origin",
    );
    const second = fixture();
    second.expectation.targetBlock.fileHash = "e".repeat(64);
    expect(() =>
      verifyTonMasterchainCheckpointChain(second.raw, second.expectation),
    ).toThrow("destination");
  });

  it("rejects a non-final backward link", () => {
    const { expectation, sourceId, targetId, first } = fixture();
    const older = { ...sourceId, seqno: 90, rootHash: "9".repeat(64) };
    const raw = partialBytes(true, sourceId, targetId, [
      backBytes(sourceId, older),
      forwardBytes({ ...first, from: older, to: targetId }),
    ]);
    expect(() => verifyTonMasterchainCheckpointChain(raw, expectation)).toThrow(
      "only a final backward link from an authenticated key block is supported",
    );
  });

  it("requires every intermediate destination to be a key block", () => {
    const { raw, expectation } = fixture(false);
    expect(() => verifyTonMasterchainCheckpointChain(raw, expectation)).toThrow(
      "does not end at a key block",
    );
  });

  it("rejects stale or future observation and target times", () => {
    const staleObservation = fixture();
    staleObservation.expectation.nowUnix += 1_000;
    expect(() =>
      verifyTonMasterchainCheckpointChain(
        staleObservation.raw,
        staleObservation.expectation,
      ),
    ).toThrow("observation is stale");

    const staleTarget = fixture();
    staleTarget.expectation.observedAtUnix += 1_000;
    staleTarget.expectation.nowUnix += 1_000;
    expect(() =>
      verifyTonMasterchainCheckpointChain(
        staleTarget.raw,
        staleTarget.expectation,
      ),
    ).toThrow("target block is stale");

    const future = fixture();
    future.expectation.observedAtUnix = future.expectation.nowUnix + 11;
    expect(() =>
      verifyTonMasterchainCheckpointChain(future.raw, future.expectation),
    ).toThrow("observation time is from the future");
  });

  it("rejects a malformed policy before decoding attacker-controlled bytes", () => {
    const { raw, expectation } = fixture();
    expectation.policyVersion = "";
    expect(() => verifyTonMasterchainCheckpointChain(raw, expectation)).toThrow(
      TonCheckpointChainError,
    );
  });
});
