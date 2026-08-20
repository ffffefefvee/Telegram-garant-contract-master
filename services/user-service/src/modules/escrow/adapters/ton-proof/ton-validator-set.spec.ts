import {
  beginCell,
  Builder,
  Cell,
  convertToMerkleProof,
  Dictionary,
  Slice,
} from "@ton/core";
import { keyPairFromSeed, sign } from "@ton/crypto";
import type { TonProofBlockId } from "./ton-proof-envelope";
import {
  tonNodeIdShort,
  tonOrdinaryBlockSignedData,
  verifyTonOrdinaryForwardLinkSignatures,
} from "./ton-lite-signature-proof";
import type { TonLiteBlockLinkForward } from "./ton-lite-signature-proof";
import {
  bindTonMasterchainHeaderValidatorSet,
  computeTonValidatorSetHash,
  deriveTonMasterchainValidatorSet,
  parseTonCatchainConfigCell,
  parseTonValidatorSetCell,
} from "./ton-validator-set";
import type { TonProvenMasterchainHeader } from "./ton-masterchain-header-proof";

interface FixtureValidator {
  publicKey: string;
  weight: bigint;
  adnlAddress?: string;
  tag?: number;
  publicKeyTag?: number;
  trailingBit?: boolean;
}

const validatorCodec = {
  serialize(src: FixtureValidator, builder: Builder): void {
    const tag = src.tag ?? (src.adnlAddress ? 0x73 : 0x53);
    builder
      .storeUint(tag, 8)
      .storeUint(src.publicKeyTag ?? 0x8e81278a, 32)
      .storeBuffer(Buffer.from(src.publicKey, "hex"))
      .storeUint(src.weight, 64);
    if (tag === 0x73) {
      builder.storeBuffer(
        Buffer.from(src.adnlAddress ?? "00".repeat(32), "hex"),
      );
    }
    if (src.trailingBit) builder.storeBit(true);
  },
  parse(_source: Slice): FixtureValidator {
    throw new Error("test codec is write-only");
  },
};

function descriptors(): FixtureValidator[] {
  return [
    { publicKey: "01".repeat(32), weight: 40n, adnlAddress: "a1".repeat(32) },
    { publicKey: "02".repeat(32), weight: 30n, adnlAddress: "a2".repeat(32) },
    { publicKey: "03".repeat(32), weight: 20n, adnlAddress: "a3".repeat(32) },
    { publicKey: "04".repeat(32), weight: 10n, adnlAddress: "a4".repeat(32) },
  ];
}

function validatorSetCell(input?: {
  extended?: boolean;
  validators?: FixtureValidator[];
  keys?: number[];
  total?: number;
  main?: number;
  declaredWeight?: bigint;
  since?: number;
  until?: number;
}): Cell {
  const validators = input?.validators ?? descriptors();
  const keys = input?.keys ?? validators.map((_, index) => index);
  const dictionary = Dictionary.empty(Dictionary.Keys.Uint(16), validatorCodec);
  validators.forEach((validator, index) => {
    dictionary.set(keys[index], validator);
  });
  const extended = input?.extended ?? true;
  const builder = beginCell()
    .storeUint(extended ? 0x12 : 0x11, 8)
    .storeUint(input?.since ?? 1000, 32)
    .storeUint(input?.until ?? 2000, 32)
    .storeUint(input?.total ?? validators.length, 16)
    .storeUint(input?.main ?? 3, 16);
  if (extended) {
    builder.storeUint(
      input?.declaredWeight ??
        validators.reduce((sum, validator) => sum + validator.weight, 0n),
      64,
    );
    builder.storeDict(dictionary);
  } else {
    builder.storeDictDirect(dictionary);
  }
  return builder.endCell();
}

function catchainCell(input?: {
  legacy?: boolean;
  shuffle?: boolean;
  flags?: number;
  values?: [number, number, number, number];
}): Cell {
  const values = input?.values ?? [200, 201, 3000, 7];
  const builder = beginCell().storeUint(input?.legacy ? 0xc1 : 0xc2, 8);
  if (!input?.legacy) {
    builder.storeUint(input?.flags ?? 0, 7).storeBit(input?.shuffle ?? false);
  }
  for (const value of values) builder.storeUint(value, 32);
  return builder.endCell();
}

describe("TON validator configuration parsing", () => {
  it("parses validators_ext with contiguous descriptors and declared weight", () => {
    const cell = validatorSetCell();
    expect(parseTonValidatorSetCell(cell)).toEqual({
      kind: "TON_PARSED_VALIDATOR_SET",
      sourceConfigProven: false,
      validatorSetProven: false,
      format: "validators_ext",
      validSinceUnix: 1000,
      validUntilUnix: 2000,
      total: 4,
      main: 3,
      totalWeight: "100",
      validators: descriptors().map((validator, index) => ({
        index,
        publicKey: validator.publicKey,
        weight: validator.weight.toString(),
        adnlAddress: validator.adnlAddress,
      })),
      cellHash: cell.hash().toString("hex"),
    });
  });

  it("parses the legacy validators format and supplies zero ADNL addresses", () => {
    const validators = descriptors().map(({ publicKey, weight }) => ({
      publicKey,
      weight,
    }));
    const parsed = parseTonValidatorSetCell(
      validatorSetCell({ extended: false, validators }),
    );
    expect(parsed.format).toBe("validators");
    expect(
      parsed.validators.every((item) => item.adnlAddress === "0".repeat(64)),
    ).toBe(true);
    expect(parsed.totalWeight).toBe("100");
  });

  it("rejects an invalid interval or total/main relationship", () => {
    expect(() =>
      parseTonValidatorSetCell(validatorSetCell({ since: 2000, until: 2000 })),
    ).toThrow("validity interval");
    expect(() =>
      parseTonValidatorSetCell(validatorSetCell({ main: 5 })),
    ).toThrow("total/main");
  });

  it("rejects a wrong declared total weight", () => {
    expect(() =>
      parseTonValidatorSetCell(validatorSetCell({ declaredWeight: 99n })),
    ).toThrow("incorrect total weight");
  });

  it("rejects missing or non-contiguous validator indices", () => {
    expect(() =>
      parseTonValidatorSetCell(validatorSetCell({ keys: [0, 1, 2, 4] })),
    ).toThrow("contiguous from zero");
    expect(() =>
      parseTonValidatorSetCell(validatorSetCell({ total: 5 })),
    ).toThrow("size does not match total");
  });

  it("rejects duplicate public keys and zero validator weight", () => {
    const duplicate = descriptors();
    duplicate[1] = { ...duplicate[1], publicKey: duplicate[0].publicKey };
    expect(() =>
      parseTonValidatorSetCell(validatorSetCell({ validators: duplicate })),
    ).toThrow("public keys must be unique");
    const zero = descriptors();
    zero[0] = { ...zero[0], weight: 0n };
    expect(() =>
      parseTonValidatorSetCell(
        validatorSetCell({ validators: zero, declaredWeight: 60n }),
      ),
    ).toThrow("weight is out of range");
  });

  it("rejects unsupported descriptor and public-key tags or trailing data", () => {
    for (const mutation of [
      { tag: 0x74 },
      { publicKeyTag: 1 },
      { trailingBit: true },
    ]) {
      const validators = descriptors();
      validators[0] = { ...validators[0], ...mutation };
      expect(() =>
        parseTonValidatorSetCell(validatorSetCell({ validators })),
      ).toThrow();
    }
  });

  it("rejects non-ordinary and unknown validator-set cells", () => {
    expect(() =>
      parseTonValidatorSetCell(
        convertToMerkleProof(beginCell().storeUint(3, 8).endCell()),
      ),
    ).toThrow("must be ordinary");
    expect(() =>
      parseTonValidatorSetCell(beginCell().storeUint(0x13, 8).endCell()),
    ).toThrow("unsupported tag");
  });
});

describe("TON catchain configuration parsing", () => {
  it("uses protocol defaults only for a proven-absent cell", () => {
    expect(parseTonCatchainConfigCell(null)).toMatchObject({
      format: "default",
      shuffleMasterchainValidators: false,
      masterchainCatchainLifetime: 200,
      shardCatchainLifetime: 200,
      shardValidatorsLifetime: 3000,
      shardValidatorsCount: 7,
      cellHash: null,
    });
  });

  it("parses legacy and shuffle-enabled catchain formats", () => {
    expect(
      parseTonCatchainConfigCell(catchainCell({ legacy: true })),
    ).toMatchObject({
      format: "catchain_config",
      shuffleMasterchainValidators: false,
    });
    expect(
      parseTonCatchainConfigCell(catchainCell({ shuffle: true })),
    ).toMatchObject({
      format: "catchain_config_new",
      shuffleMasterchainValidators: true,
    });
  });

  it("rejects nonzero flags, zero required values and trailing bits", () => {
    expect(() =>
      parseTonCatchainConfigCell(catchainCell({ flags: 1 })),
    ).toThrow("flags");
    expect(() =>
      parseTonCatchainConfigCell(catchainCell({ values: [0, 1, 1, 1] })),
    ).toThrow("zero required value");
    expect(() =>
      parseTonCatchainConfigCell(
        beginCell()
          .storeSlice(catchainCell().beginParse())
          .storeBit(true)
          .endCell(),
      ),
    ).toThrow();
  });
});

describe("TON masterchain validator-set derivation", () => {
  const parsed = () => parseTonValidatorSetCell(validatorSetCell());

  it("selects the first main validators and reproduces the official CRC32C hash", () => {
    const derived = deriveTonMasterchainValidatorSet(
      parsed(),
      parseTonCatchainConfigCell(catchainCell({ shuffle: false })),
      7,
    );
    expect(derived).toMatchObject({
      sourceConfigProven: false,
      selectionReproduced: true,
      validatorSetHashReproduced: true,
      validatorSetProven: false,
      finalityProven: false,
      catchainSeqno: 7,
      validatorSetHash: 466976984,
      shuffled: false,
      totalWeight: "90",
    });
    expect(derived.validators.map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it("reproduces TON's SHA-512 masterchain shuffle and its order-sensitive hash", () => {
    const derived = deriveTonMasterchainValidatorSet(
      parsed(),
      parseTonCatchainConfigCell(catchainCell({ shuffle: true })),
      7,
    );
    expect(derived.validators.map((item) => item.index)).toEqual([1, 2, 0]);
    expect(derived.validatorSetHash).toBe(2971001822);
    expect(derived.totalWeight).toBe("90");
  });

  it("changes the shuffle and short hash across catchain sequences", () => {
    const config = parseTonCatchainConfigCell(catchainCell({ shuffle: true }));
    const first = deriveTonMasterchainValidatorSet(parsed(), config, 7);
    const second = deriveTonMasterchainValidatorSet(parsed(), config, 8);
    expect(second.validatorSetHash).not.toBe(first.validatorSetHash);
    expect(second.signatureValidatorSet.catchainSeqno).toBe(8);
  });

  it("validates direct hash inputs", () => {
    const selected = parsed().validators.slice(0, 3);
    expect(computeTonValidatorSetHash(7, selected)).toBe(466976984);
    expect(() => computeTonValidatorSetHash(7, [])).toThrow("count");
    expect(() =>
      computeTonValidatorSetHash(7, [{ ...selected[0], adnlAddress: "bad" }]),
    ).toThrow("invalid identity");
    expect(() =>
      computeTonValidatorSetHash(7, [{ ...selected[0], weight: "040" }]),
    ).toThrow("non-canonical weight");
  });

  it("binds the reproduced catchain and short hash to the proven header", () => {
    const derived = deriveTonMasterchainValidatorSet(
      parsed(),
      parseTonCatchainConfigCell(catchainCell({ shuffle: false })),
      7,
    );
    const header = {
      rootHashVerified: true,
      signaturesVerified: false,
      finalityProven: false,
      catchainSeqno: 7,
      validatorListHashShort: derived.validatorSetHash,
      block: { rootHash: "11".repeat(32) },
    } as TonProvenMasterchainHeader;
    expect(bindTonMasterchainHeaderValidatorSet(header, derived)).toEqual({
      kind: "TON_HEADER_VALIDATOR_SET_BINDING",
      headerBindingVerified: true,
      sourceConfigProven: false,
      validatorSetProven: false,
      finalityProven: false,
      blockRootHash: "11".repeat(32),
      catchainSeqno: 7,
      validatorSetHash: 466976984,
      validatorCount: 3,
    });
    expect(() =>
      bindTonMasterchainHeaderValidatorSet(
        { ...header, catchainSeqno: 8 },
        derived,
      ),
    ).toThrow("catchain sequence");
    expect(() =>
      bindTonMasterchainHeaderValidatorSet(
        { ...header, validatorListHashShort: 1 },
        derived,
      ),
    ).toThrow("validator-list hash");
  });

  it("hands the derived set to signature verification without upgrading provenance", () => {
    const keyPairs = [1, 2, 3].map((marker) =>
      keyPairFromSeed(Buffer.alloc(32, marker)),
    );
    const configValidators: FixtureValidator[] = keyPairs.map((key, index) => ({
      publicKey: key.publicKey.toString("hex"),
      weight: [4n, 3n, 2n][index],
      adnlAddress: (index + 1).toString(16).padStart(2, "0").repeat(32),
    }));
    const source = parseTonValidatorSetCell(
      validatorSetCell({
        validators: configValidators,
        total: 3,
        main: 3,
        declaredWeight: 9n,
      }),
    );
    const derived = deriveTonMasterchainValidatorSet(
      source,
      parseTonCatchainConfigCell(catchainCell({ legacy: true })),
      7,
    );
    const block: TonProofBlockId = {
      workchain: -1,
      shard: "-9223372036854775808",
      seqno: 101,
      rootHash: "11".repeat(32),
      fileHash: "22".repeat(32),
    };
    const signedData = tonOrdinaryBlockSignedData(block);
    const link: TonLiteBlockLinkForward = {
      kind: "forward",
      toKeyBlock: false,
      from: { ...block, seqno: 100, rootHash: "33".repeat(32) },
      to: block,
      destProof: Buffer.alloc(0),
      configProof: Buffer.alloc(0),
      signatures: {
        kind: "ordinary",
        validatorSetHash: derived.validatorSetHash,
        catchainSeqno: 7,
        signatures: keyPairs.slice(0, 2).map((key) => ({
          nodeIdShort: tonNodeIdShort(key.publicKey).toString("hex"),
          signature: sign(signedData, key.secretKey),
        })),
      },
    };
    expect(
      verifyTonOrdinaryForwardLinkSignatures(
        link,
        derived.signatureValidatorSet,
      ),
    ).toMatchObject({
      signaturesVerified: true,
      validatorSetProven: false,
      finalityProven: false,
      signedWeight: "7",
      totalWeight: "9",
    });
  });
});
