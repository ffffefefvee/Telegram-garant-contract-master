import { beginCell, Cell, convertToMerkleProof } from "@ton/core";
import {
  TonProofBundle,
  TonTrustedNetworkConfig,
  validateTonProofEnvelope,
} from "./ton-proof-envelope";

const NOW = 1_800_000_000;
const MC_SHARD = "-9223372036854775808";

function block(seqno: number, rootHash: string, fileDigit: string) {
  return {
    workchain: -1,
    shard: MC_SHARD,
    seqno,
    rootHash,
    fileHash: fileDigit.repeat(64),
  };
}

function proofCell(seed: number, nested = false): { inner: Cell; boc: Buffer } {
  const leaf = beginCell().storeUint(seed, 32).endCell();
  const inner = nested ? beginCell().storeRef(leaf).endCell() : leaf;
  return {
    inner,
    boc: convertToMerkleProof(inner).toBoc({ idx: false, crc32: false }),
  };
}

function validFixture() {
  const masterchain = proofCell(1);
  const proofs = [
    masterchain,
    proofCell(2),
    proofCell(3),
    proofCell(4),
    proofCell(5),
  ];
  const config: TonTrustedNetworkConfig = {
    policyVersion: "phase1-envelope-v1",
    network: "testnet",
    globalId: -3,
    zeroState: block(0, "1".repeat(64), "2"),
    trustedKeyBlock: block(100, "3".repeat(64), "4"),
    maxProofAgeSeconds: 300,
    maxFutureSkewSeconds: 15,
    limits: { maxBocBytes: 4096, maxCells: 32, maxDepth: 16 },
  };
  const bundle: TonProofBundle = {
    network: "testnet",
    observedAtUnix: NOW - 10,
    targetMasterchainBlock: block(
      101,
      masterchain.inner.hash().toString("hex"),
      "5",
    ),
    proofs: {
      masterchainBlockProofBocBase64: proofs[0].boc.toString("base64"),
      shardDescriptorProofBocBase64: proofs[1].boc.toString("base64"),
      shardBlockProofBocBase64: proofs[2].boc.toString("base64"),
      masterAccountProofBocBase64: proofs[3].boc.toString("base64"),
      walletAccountProofBocBase64: proofs[4].boc.toString("base64"),
    },
  };
  return { config, bundle, proofs };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("TON proof envelope foundation", () => {
  it("commits to a structurally valid envelope but never authorizes it", () => {
    const { config, bundle } = validFixture();
    const result = validateTonProofEnvelope(config, bundle, NOW);
    expect(result).toMatchObject({
      accepted: false,
      proofsVerified: false,
      authorizationAllowed: false,
      structuralChecksPassed: true,
      reasonCode: "CRYPTOGRAPHIC_VERIFICATION_REQUIRED",
      verificationEvidenceHash: null,
    });
    expect(result.structuralEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.remainingChecks).toContain(
      "TRUSTED_MASTERCHAIN_SIGNATURE_CHAIN",
    );
  });

  it("is deterministic and binds proof roles and trusted policy", () => {
    const { config, bundle } = validFixture();
    const first = validateTonProofEnvelope(config, bundle, NOW);
    expect(validateTonProofEnvelope(clone(config), clone(bundle), NOW)).toEqual(
      first,
    );
    const changed = clone(config);
    changed.policyVersion = "phase1-envelope-v2";
    expect(
      validateTonProofEnvelope(changed, bundle, NOW).structuralEvidenceHash,
    ).not.toBe(first.structuralEvidenceHash);

    const swapped = clone(bundle);
    [
      swapped.proofs.shardBlockProofBocBase64,
      swapped.proofs.walletAccountProofBocBase64,
    ] = [
      swapped.proofs.walletAccountProofBocBase64,
      swapped.proofs.shardBlockProofBocBase64,
    ];
    expect(
      validateTonProofEnvelope(config, swapped, NOW).structuralEvidenceHash,
    ).not.toBe(first.structuralEvidenceHash);
  });

  it.each([
    ["mainnet", -3],
    ["testnet", -239],
  ])("rejects the wrong global ID for %s", (network, globalId) => {
    const { config, bundle } = validFixture();
    config.network = network as "mainnet" | "testnet";
    config.globalId = globalId;
    bundle.network = config.network;
    expect(validateTonProofEnvelope(config, bundle, NOW).reasonCode).toBe(
      "INVALID_TRUSTED_CONFIG",
    );
  });

  it("rejects an untrusted bundle network", () => {
    const { config, bundle } = validFixture();
    bundle.network = "mainnet";
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "network",
    );
  });

  it.each([
    [NOW - 301, "stale"],
    [NOW + 16, "future"],
  ])("rejects observation time %i as %s", (observedAtUnix, expected) => {
    const { config, bundle } = validFixture();
    bundle.observedAtUnix = observedAtUnix;
    const result = validateTonProofEnvelope(config, bundle, NOW);
    expect(result.reasonCode).toBe("STALE_PROOF_BUNDLE");
    expect(result.detail).toContain(expected);
  });

  it("rejects a target that does not advance the trusted key block", () => {
    const { config, bundle } = validFixture();
    bundle.targetMasterchainBlock.seqno = config.trustedKeyBlock.seqno;
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "advance",
    );
  });

  it("rejects non-masterchain target identity and zero hashes", () => {
    const { config, bundle } = validFixture();
    bundle.targetMasterchainBlock.workchain = 0;
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "masterchain",
    );
    const second = validFixture();
    second.bundle.targetMasterchainBlock.fileHash = "0".repeat(64);
    expect(
      validateTonProofEnvelope(second.config, second.bundle, NOW).detail,
    ).toContain("hashes");
    const third = validFixture();
    third.bundle.targetMasterchainBlock.shard = "-0";
    expect(
      validateTonProofEnvelope(third.config, third.bundle, NOW).detail,
    ).toContain("canonical");
  });

  it("rejects an unexpected field in trusted config or bundle", () => {
    const { config, bundle } = validFixture();
    const badConfig = { ...config, callerTrusted: true };
    expect(validateTonProofEnvelope(badConfig, bundle, NOW).reasonCode).toBe(
      "INVALID_TRUSTED_CONFIG",
    );
    const badBundle = { ...bundle, proofsVerified: true };
    expect(validateTonProofEnvelope(config, badBundle, NOW).reasonCode).toBe(
      "INVALID_PROOF_BUNDLE",
    );
  });

  it.each(["", "not-base64", "AAAA====", " AAAA"])(
    "rejects non-canonical base64 %p",
    (encoded) => {
      const { config, bundle } = validFixture();
      bundle.proofs.walletAccountProofBocBase64 = encoded;
      expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
        "canonical base64",
      );
    },
  );

  it("rejects proof BOCs over the configured byte limit", () => {
    const { config, bundle, proofs } = validFixture();
    config.limits.maxBocBytes = proofs[0].boc.length - 1;
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "byte limit",
    );
  });

  it("rejects a valid BOC with a trailing byte", () => {
    const { config, bundle, proofs } = validFixture();
    bundle.proofs.walletAccountProofBocBase64 = Buffer.concat([
      proofs[4].boc,
      Buffer.from([0]),
    ]).toString("base64");
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "trailing or missing",
    );
  });

  it("rejects unused bytes inside the declared cell-data section", () => {
    const { config, bundle, proofs } = validFixture();
    const original = proofs[4].boc;
    expect(original[5]).toBe(1);
    const totalCellSizeOffset = 9;
    const cellDataEnd = original.length;
    const unusedCellData = Buffer.concat([
      original.subarray(0, cellDataEnd),
      Buffer.from([0]),
    ]);
    unusedCellData[totalCellSizeOffset] += 1;
    bundle.proofs.walletAccountProofBocBase64 =
      unusedCellData.toString("base64");
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "unused bytes",
    );
  });

  it("rejects multiple BOC roots before deserialization", () => {
    const { config, bundle, proofs } = validFixture();
    const original = proofs[4].boc;
    expect(original.readUInt32BE(0)).toBe(0xb5ee9c72);
    expect(original[7]).toBe(1);
    const multipleRoots = Buffer.concat([
      original.subarray(0, 7),
      Buffer.from([2]),
      original.subarray(8, 11),
      Buffer.from([0]),
      original.subarray(11),
    ]);
    bundle.proofs.walletAccountProofBocBase64 =
      multipleRoots.toString("base64");
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "one complete root",
    );
  });

  it("rejects an ordinary root in place of a Merkle proof", () => {
    const { config, bundle } = validFixture();
    bundle.proofs.walletAccountProofBocBase64 = beginCell()
      .storeUint(7, 8)
      .endCell()
      .toBoc({ idx: false, crc32: false })
      .toString("base64");
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "MerkleProof root",
    );
  });

  it("rejects a one-bit corruption when CRC32C is present", () => {
    const { config, bundle } = validFixture();
    const crcProof = convertToMerkleProof(
      beginCell().storeUint(99, 32).endCell(),
    ).toBoc({ idx: false, crc32: true });
    crcProof[crcProof.length - 5] ^= 1;
    bundle.proofs.walletAccountProofBocBase64 = crcProof.toString("base64");
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "Invalid CRC32C",
    );
  });

  it("rejects BOCs over the configured cell count", () => {
    const { config, bundle } = validFixture();
    config.limits.maxCells = 1;
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "cell count",
    );
  });

  it("rejects proofs over the configured depth", () => {
    const { config, bundle } = validFixture();
    const nested = proofCell(8, true);
    bundle.proofs.walletAccountProofBocBase64 = nested.boc.toString("base64");
    config.limits.maxDepth = 1;
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "depth limit",
    );
  });

  it("binds the masterchain proof virtual root to the target block", () => {
    const { config, bundle } = validFixture();
    bundle.targetMasterchainBlock.rootHash = "a".repeat(64);
    expect(validateTonProofEnvelope(config, bundle, NOW).detail).toContain(
      "target root hash",
    );
  });

  it("rejects invalid caller time without throwing", () => {
    const { config, bundle } = validFixture();
    expect(validateTonProofEnvelope(config, bundle, -1).reasonCode).toBe(
      "INVALID_PROOF_BUNDLE",
    );
  });
});
