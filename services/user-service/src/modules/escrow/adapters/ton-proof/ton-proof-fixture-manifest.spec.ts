import { createHash } from "crypto";
import {
  TON_PROOF_FIXTURE_ARTIFACT_NAMES,
  verifyTonProofFixtureManifest,
} from "./ton-proof-fixture-manifest";

const MC_SHARD = "-9223372036854775808";
const MAINNET_ZERO_ROOT =
  "17a3a92992aabea785a7a090985a265cd31f323d849da51239737e321fb05569";
const MAINNET_ZERO_FILE =
  "5e994fcf4d425c0a6ce6a792594b7173205f740a39cd56f537defd28b48a0f6e";

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function block(workchain: -1 | 0, seqno: number, marker: number) {
  return {
    workchain,
    shard: workchain === -1 ? MC_SHARD : "-9223372036854775808",
    seqno,
    rootHash: marker.toString(16).padStart(64, "0"),
    fileHash: (marker + 100).toString(16).padStart(64, "0"),
  };
}

function fixture() {
  const artifacts = Object.fromEntries(
    TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((name, index) => [
      name,
      Buffer.from(`artifact:${index}:${name}`),
    ]),
  ) as Record<string, Buffer>;
  const manifest = {
    schemaVersion: 1,
    kind: "TON_CAPTURED_PROOF_FIXTURE",
    network: "mainnet",
    globalId: -239,
    capturedAtUnix: 1_800_000_000,
    source: {
      globalConfigUrl: "https://ton.org/global.config.json",
      liteServerCount: 18,
      captureTool: "scripts/capture-ton-proof-fixture.ts",
    },
    zeroState: {
      workchain: -1,
      shard: MC_SHARD,
      seqno: 0,
      rootHash: MAINNET_ZERO_ROOT,
      fileHash: MAINNET_ZERO_FILE,
    },
    trustedKeyBlock: block(-1, 100, 1),
    targetMasterchainBlock: block(-1, 101, 2),
    masterAddress: `0:${"11".repeat(32)}`,
    ownerAddress: `0:${"22".repeat(32)}`,
    walletAddress: `0:${"33".repeat(32)}`,
    walletCodeHash: "77".repeat(32),
    masterShardBlock: block(0, 200, 3),
    walletShardBlock: block(0, 201, 4),
    masterLastTransaction: { lt: "1000", hash: "55".repeat(32) },
    walletLastTransaction: null,
    selectedShardTransaction: {
      accountAddress: `0:${"44".repeat(32)}`,
      lt: "2000",
      hash: "66".repeat(32),
    },
    artifacts: Object.fromEntries(
      TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((name) => [
        name,
        { bytes: artifacts[name].length, sha256: hash(artifacts[name]) },
      ]),
    ),
  };
  return {
    manifest,
    raw: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    artifacts,
  };
}

describe("TON proof fixture manifest", () => {
  it("pins network identity and verifies the exact immutable artifact set", () => {
    const { raw, artifacts } = fixture();
    const result = verifyTonProofFixtureManifest(raw, artifacts);
    expect(result).toMatchObject({
      kind: "TON_VERIFIED_PROOF_FIXTURE_MANIFEST",
      manifestVerified: true,
      artifactSetVerified: true,
      networkIdentityVerified: true,
      replayPerformed: false,
      authorizationAllowed: false,
      manifest: { network: "mainnet", globalId: -239 },
    });
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.artifactSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.artifacts["checkpoint-proof.tl"]).not.toBe(
      artifacts["checkpoint-proof.tl"],
    );
  });

  it.each(TON_PROOF_FIXTURE_ARTIFACT_NAMES)(
    "rejects one-bit corruption of %s before replay",
    (name) => {
      const { raw, artifacts } = fixture();
      artifacts[name] = Buffer.from(artifacts[name]);
      artifacts[name][0] ^= 1;
      expect(() => verifyTonProofFixtureManifest(raw, artifacts)).toThrow(
        `${name} hash mismatch`,
      );
    },
  );

  it("rejects missing and additional artifacts", () => {
    const missing = fixture();
    delete missing.artifacts["transaction.boc"];
    expect(() =>
      verifyTonProofFixtureManifest(missing.raw, missing.artifacts),
    ).toThrow("artifact set is not exact");

    const additional = fixture();
    additional.artifacts["unexpected.log"] = Buffer.from("secret");
    expect(() =>
      verifyTonProofFixtureManifest(additional.raw, additional.artifacts),
    ).toThrow("artifact set is not exact");
  });

  it("rejects descriptor length drift independently of its hash", () => {
    const value = fixture();
    value.manifest.artifacts["transaction.boc"].bytes += 1;
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(value.manifest)),
        value.artifacts,
      ),
    ).toThrow("transaction.boc byte length mismatch");
  });

  it("pins the network global ID, config URL, and zerostate", () => {
    const globalId = fixture();
    globalId.manifest.globalId = -3;
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(globalId.manifest)),
        globalId.artifacts,
      ),
    ).toThrow("global ID is not pinned");

    const url = fixture();
    url.manifest.source.globalConfigUrl = "https://example.com/config.json";
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(url.manifest)),
        url.artifacts,
      ),
    ).toThrow("config URL is not pinned");

    const zero = fixture();
    zero.manifest.zeroState.rootHash = "77".repeat(32);
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(zero.manifest)),
        zero.artifacts,
      ),
    ).toThrow("zerostate identity is not pinned");
  });

  it("rejects unknown manifest fields and unsupported schemas", () => {
    const extra = fixture();
    const raw = Buffer.from(
      JSON.stringify({ ...extra.manifest, providerAccepted: true }),
    );
    expect(() => verifyTonProofFixtureManifest(raw, extra.artifacts)).toThrow(
      "manifest must contain exactly",
    );
    const schema = fixture();
    schema.manifest.schemaVersion = 2;
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(schema.manifest)),
        schema.artifacts,
      ),
    ).toThrow("schemaVersion is unsupported");
  });

  it("rejects checkpoint, address, transaction, and source-shape drift", () => {
    const range = fixture();
    range.manifest.targetMasterchainBlock.seqno = 100;
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(range.manifest)),
        range.artifacts,
      ),
    ).toThrow("checkpoint range is invalid");

    const address = fixture();
    address.manifest.walletAddress = `0:${"AA".repeat(32)}`;
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(address.manifest)),
        address.artifacts,
      ),
    ).toThrow("canonical basechain address");

    const lt = fixture();
    lt.manifest.selectedShardTransaction.lt = "01";
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(lt.manifest)),
        lt.artifacts,
      ),
    ).toThrow("canonical uint64");

    const source = fixture();
    source.manifest.source.liteServerCount = 1;
    expect(() =>
      verifyTonProofFixtureManifest(
        Buffer.from(JSON.stringify(source.manifest)),
        source.artifacts,
      ),
    ).toThrow("liteServerCount is out of range");
  });

  it("rejects malformed, empty, and oversized manifest bytes", () => {
    const value = fixture();
    expect(() =>
      verifyTonProofFixtureManifest(Buffer.from("{"), value.artifacts),
    ).toThrow("valid UTF-8 JSON");
    expect(() =>
      verifyTonProofFixtureManifest(Buffer.alloc(0), value.artifacts),
    ).toThrow("byte length");
    expect(() =>
      verifyTonProofFixtureManifest(Buffer.alloc(256 * 1024 + 1), value.artifacts),
    ).toThrow("byte length");
  });

  it("changes the artifact-set commitment when a valid artifact changes", () => {
    const first = fixture();
    const firstResult = verifyTonProofFixtureManifest(first.raw, first.artifacts);
    const second = fixture();
    second.artifacts["transaction.boc"] = Buffer.from("replacement");
    second.manifest.artifacts["transaction.boc"] = {
      bytes: second.artifacts["transaction.boc"].length,
      sha256: hash(second.artifacts["transaction.boc"]),
    };
    const secondResult = verifyTonProofFixtureManifest(
      Buffer.from(JSON.stringify(second.manifest)),
      second.artifacts,
    );
    expect(secondResult.artifactSetHash).not.toBe(firstResult.artifactSetHash);
  });
});
