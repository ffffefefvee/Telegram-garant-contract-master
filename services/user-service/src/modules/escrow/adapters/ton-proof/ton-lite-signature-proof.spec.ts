import { keyPairFromSeed, sign } from "@ton/crypto";
import type { TonProofBlockId } from "./ton-proof-envelope";
import {
  decodeTonLitePartialBlockProof,
  tonNodeIdShort,
  tonOrdinaryBlockSignedData,
  verifyTonOrdinaryForwardLinkSignatures,
} from "./ton-lite-signature-proof";
import type {
  TonLiteBlockLinkForward,
  TonLiteProofLimits,
  TonLiteSignature,
  TonUnprovenValidatorSet,
} from "./ton-lite-signature-proof";

const IDS = {
  partial: 0x8ed0d2c1,
  back: 0xef7e1bef,
  forward: 0x520fce1c,
  ordinary: 0xf644a6e6,
  signature: 0xa3def855,
  vector: 0x1cb5c415,
  boolTrue: 0x997275b5,
  boolFalse: 0xbc799737,
};
const MASTERCHAIN_SHARD = -(1n << 63n);
const limits: TonLiteProofLimits = {
  maxBytes: 16_384,
  maxLinks: 8,
  maxSignaturesPerLink: 16,
  maxEmbeddedProofBytes: 1024,
};

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
  const padding = Buffer.alloc((4 - ((prefix.length + value.length) % 4)) % 4);
  return Buffer.concat([prefix, value, padding]);
}

function vector(items: readonly Buffer[]): Buffer {
  return Buffer.concat([u32(IDS.vector), u32(items.length), ...items]);
}

function block(seqno: number, marker: number): TonProofBlockId {
  return {
    workchain: -1,
    shard: MASTERCHAIN_SHARD.toString(),
    seqno,
    rootHash: marker.toString(16).padStart(64, "0"),
    fileHash: (marker + 100).toString(16).padStart(64, "0"),
  };
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
    u32(IDS.signature),
    Buffer.from(value.nodeIdShort, "hex"),
    tlBytes(value.signature),
  ]);
}

function forwardBytes(
  from: TonProofBlockId,
  to: TonProofBlockId,
  signatures: readonly TonLiteSignature[] = [],
  signatureSetConstructor = IDS.ordinary,
): Buffer {
  return Buffer.concat([
    u32(IDS.forward),
    u32(IDS.boolFalse),
    blockBytes(from),
    blockBytes(to),
    tlBytes(Buffer.from([1, 2, 3])),
    tlBytes(Buffer.from([4, 5, 6])),
    u32(signatureSetConstructor),
    u32(0x11223344),
    u32(17),
    vector(signatures.map(signatureBytes)),
  ]);
}

function backBytes(from: TonProofBlockId, to: TonProofBlockId): Buffer {
  return Buffer.concat([
    u32(IDS.back),
    u32(IDS.boolTrue),
    blockBytes(from),
    blockBytes(to),
    tlBytes(Buffer.from([1])),
    tlBytes(Buffer.from([2])),
    tlBytes(Buffer.from([3])),
  ]);
}

function partialBytes(
  from: TonProofBlockId,
  to: TonProofBlockId,
  steps: readonly Buffer[],
): Buffer {
  return Buffer.concat([
    u32(IDS.partial),
    u32(IDS.boolTrue),
    blockBytes(from),
    blockBytes(to),
    vector(steps),
  ]);
}

function decode(raw: Buffer, overrides: Partial<TonLiteProofLimits> = {}) {
  return decodeTonLitePartialBlockProof(raw.toString("base64"), {
    ...limits,
    ...overrides,
  });
}

const keys = [1, 2, 3, 4].map((marker) =>
  keyPairFromSeed(Buffer.alloc(32, marker)),
);
const from = block(100, 1);
const to = block(101, 2);

function validatorSet(): TonUnprovenValidatorSet {
  return {
    validatorSetHash: 0x11223344,
    catchainSeqno: 17,
    validators: keys.map((key, index) => ({
      publicKey: key.publicKey.toString("hex"),
      weight: ["4", "3", "2", "1"][index],
    })),
  };
}

function signedLink(signerIndexes: readonly number[]): TonLiteBlockLinkForward {
  const data = tonOrdinaryBlockSignedData(to);
  return {
    kind: "forward",
    toKeyBlock: false,
    from,
    to,
    destProof: Buffer.from([1]),
    configProof: Buffer.from([2]),
    signatures: {
      kind: "ordinary",
      validatorSetHash: 0x11223344,
      catchainSeqno: 17,
      signatures: signerIndexes.map((index) => ({
        nodeIdShort: tonNodeIdShort(keys[index].publicKey).toString("hex"),
        signature: sign(data, keys[index].secretKey),
      })),
    },
  };
}

describe("TON LiteServer partial block proof decoding", () => {
  it("strictly decodes a contiguous ordinary forward link", () => {
    const parsed = decode(partialBytes(from, to, [forwardBytes(from, to)]));
    expect(parsed).toMatchObject({ complete: true, from, to });
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]).toMatchObject({
      kind: "forward",
      from,
      to,
      signatures: {
        kind: "ordinary",
        validatorSetHash: 0x11223344,
        catchainSeqno: 17,
      },
    });
    expect(parsed.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("strictly decodes a backward key-block link", () => {
    const parsed = decode(partialBytes(to, from, [backBytes(to, from)]));
    expect(parsed.steps[0]).toMatchObject({ kind: "back", toKeyBlock: true });
  });

  it("allows an empty proof only when both endpoints are identical", () => {
    expect(decode(partialBytes(from, from, [])).steps).toEqual([]);
    expect(() => decode(partialBytes(from, to, []))).toThrow(
      "empty partial proof does not have identical endpoints",
    );
  });

  it("rejects non-canonical base64", () => {
    expect(() => decodeTonLitePartialBlockProof("abc", limits)).toThrow(
      "canonical base64",
    );
  });

  it("rejects the wrong top-level constructor", () => {
    const raw = partialBytes(from, to, [forwardBytes(from, to)]);
    raw.writeUInt32LE(0, 0);
    expect(() => decode(raw)).toThrow("invalid PartialBlockProof constructor");
  });

  it("rejects trailing TL bytes", () => {
    const raw = Buffer.concat([
      partialBytes(from, to, [forwardBytes(from, to)]),
      Buffer.alloc(4),
    ]);
    expect(() => decode(raw)).toThrow("trailing bytes");
  });

  it("enforces the raw-byte limit before parsing", () => {
    const raw = partialBytes(from, to, [forwardBytes(from, to)]);
    expect(() => decode(raw, { maxBytes: raw.length - 1 })).toThrow(
      "exceeds maxBytes",
    );
  });

  it("enforces the link-count limit", () => {
    const final = block(102, 3);
    expect(() =>
      decode(
        partialBytes(from, final, [
          forwardBytes(from, to),
          forwardBytes(to, final),
        ]),
        { maxLinks: 1 },
      ),
    ).toThrow("steps exceeds its item limit");
  });

  it("rejects a Simplex or unknown signature set without reinterpretation", () => {
    expect(() =>
      decode(partialBytes(from, to, [forwardBytes(from, to, [], 0x01020304)])),
    ).toThrow("unsupported non-ordinary signature set");
  });

  it("rejects a discontinuous step", () => {
    const wrong = block(99, 9);
    expect(() =>
      decode(partialBytes(from, to, [forwardBytes(wrong, to)])),
    ).toThrow("not contiguous");
  });

  it("rejects a forward link that does not advance sequence", () => {
    expect(() =>
      decode(partialBytes(from, from, [forwardBytes(from, from)])),
    ).toThrow("does not advance");
  });

  it("rejects non-masterchain endpoints", () => {
    const invalid = { ...from, workchain: 0, shard: "0" };
    expect(() => decode(partialBytes(invalid, invalid, []))).toThrow(
      "origin is not a masterchain block",
    );
  });
});

describe("TON ordinary validator signatures", () => {
  it("uses the canonical Ed25519 public-key short-ID domain", () => {
    expect(tonNodeIdShort(Buffer.alloc(32)).toString("hex")).toBe(
      "5dcc566cb9a2a4b9408b7e36d1226dceb36b6be586a2583cae540979638c600e",
    );
  });

  it("serializes only the TON internal block-ID constructor and hashes", () => {
    const data = tonOrdinaryBlockSignedData(to);
    expect(data).toHaveLength(68);
    expect(data.subarray(0, 4).toString("hex")).toBe("706e0bc5");
    expect(data.subarray(4, 36).toString("hex")).toBe(to.rootHash);
    expect(data.subarray(36).toString("hex")).toBe(to.fileHash);
  });

  it("verifies unique Ed25519 signatures with strictly more than two-thirds weight", () => {
    const result = verifyTonOrdinaryForwardLinkSignatures(
      signedLink([0, 1]),
      validatorSet(),
    );
    expect(result).toMatchObject({
      signaturesVerified: true,
      thresholdVerified: true,
      validatorSetProven: false,
      finalityProven: false,
      signedWeight: "7",
      totalWeight: "10",
      signerCount: 2,
      block: to,
    });
  });

  it("rejects exactly two-thirds weight", () => {
    const set = validatorSet();
    set.validators = [
      { publicKey: keys[0].publicKey.toString("hex"), weight: "1" },
      { publicKey: keys[1].publicKey.toString("hex"), weight: "1" },
      { publicKey: keys[2].publicKey.toString("hex"), weight: "1" },
    ];
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(signedLink([0, 1]), set),
    ).toThrow("does not exceed two thirds");
  });

  it("rejects duplicate signers", () => {
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(
        signedLink([0, 0]),
        validatorSet(),
      ),
    ).toThrow("duplicate signer");
  });

  it("rejects unknown signers", () => {
    const link = signedLink([0, 1]);
    link.signatures.signatures = [
      ...link.signatures.signatures,
      {
        nodeIdShort: "ff".repeat(32),
        signature: Buffer.alloc(64),
      },
    ];
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(link, validatorSet()),
    ).toThrow("unknown validator");
  });

  it("rejects a signature made for another block", () => {
    const link = signedLink([0, 1]);
    link.signatures.signatures[0].signature = sign(
      tonOrdinaryBlockSignedData(block(102, 3)),
      keys[0].secretKey,
    );
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(link, validatorSet()),
    ).toThrow("invalid validator signature");
  });

  it("binds validator-set hash and catchain sequence", () => {
    const link = signedLink([0, 1]);
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(link, {
        ...validatorSet(),
        validatorSetHash: 1,
      }),
    ).toThrow("validator set hash mismatch");
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(link, {
        ...validatorSet(),
        catchainSeqno: 18,
      }),
    ).toThrow("catchain sequence mismatch");
  });

  it("rejects duplicate validator keys and non-canonical weights", () => {
    const set = validatorSet();
    set.validators = [set.validators[0], set.validators[0]];
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(signedLink([0, 1]), set),
    ).toThrow("duplicate nodes");
    const invalidWeight = validatorSet();
    invalidWeight.validators = [
      { ...invalidWeight.validators[0], weight: "01" },
    ];
    expect(() =>
      verifyTonOrdinaryForwardLinkSignatures(signedLink([0]), invalidWeight),
    ).toThrow("not a canonical weight");
  });
});
