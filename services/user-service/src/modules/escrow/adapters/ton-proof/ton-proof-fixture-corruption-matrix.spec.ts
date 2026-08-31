import { createHash } from "crypto";
import {
  runTonProofFixtureCorruptionMatrix,
  TonProofFixtureCorruptionMatrixError,
} from "./ton-proof-fixture-corruption-matrix";
import { TON_PROOF_FIXTURE_ARTIFACT_NAMES } from "./ton-proof-fixture-manifest";
import { replayTonProofFixtureOffline } from "./ton-proof-fixture-replay";

jest.mock("./ton-proof-fixture-replay", () => ({
  replayTonProofFixtureOffline: jest.fn(),
}));

const MC_SHARD = "-9223372036854775808";
const ZERO_ROOT =
  "17a3a92992aabea785a7a090985a265cd31f323d849da51239737e321fb05569";
const ZERO_FILE =
  "5e994fcf4d425c0a6ce6a792594b7173205f740a39cd56f537defd28b48a0f6e";

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function block(workchain: -1 | 0, seqno: number, marker: number) {
  return {
    workchain,
    shard: MC_SHARD,
    seqno,
    rootHash: marker.toString(16).padStart(64, "0"),
    fileHash: (marker + 100).toString(16).padStart(64, "0"),
  };
}

function fixture() {
  const artifacts = Object.fromEntries(
    TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((name, index) => [
      name,
      Buffer.from(`matrix:${index}:${name}`),
    ]),
  ) as Record<string, Buffer>;
  artifacts["official-global-config.json"] = Buffer.from(
    JSON.stringify({
      validator: {
        zero_state: {
          workchain: -1,
          shard: -9223372036854776000,
          seqno: 0,
          root_hash: Buffer.from(ZERO_ROOT, "hex").toString("base64"),
          file_hash: Buffer.from(ZERO_FILE, "hex").toString("base64"),
        },
      },
      liteservers: Array.from({ length: 18 }, (_, index) => ({
        ip: index + 1,
        port: 1000 + index,
        id: {
          "@type": "pub.ed25519",
          key: Buffer.alloc(32, index + 1).toString("base64"),
        },
      })),
    }),
  );
  const manifest = {
    schemaVersion: 2,
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
      rootHash: ZERO_ROOT,
      fileHash: ZERO_FILE,
    },
    trustedKeyBlock: block(-1, 100, 1),
    targetMasterchainBlock: block(-1, 101, 2),
    masterAddress: `0:${"11".repeat(32)}`,
    ownerAddress: `0:${"12".repeat(32)}`,
    walletAddress: `0:${"13".repeat(32)}`,
    walletCodeHash: "14".repeat(32),
    walletContractProfile: "tep74-reference-wallet-v1",
    masterShardBlock: block(0, 200, 3),
    walletShardBlock: block(0, 201, 4),
    masterLastTransaction: null,
    walletLastTransaction: null,
    selectedShardTransaction: {
      accountAddress: `0:${"15".repeat(32)}`,
      lt: "3000",
      hash: "16".repeat(32),
    },
    artifacts: Object.fromEntries(
      TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((name) => [
        name,
        { bytes: artifacts[name].length, sha256: sha256(artifacts[name]) },
      ]),
    ),
  };
  return { raw: Buffer.from(JSON.stringify(manifest)), artifacts };
}

describe("TON proof fixture corruption matrix", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rehashes each one-bit mutation and requires every replay to reject it", async () => {
    jest
      .mocked(replayTonProofFixtureOffline)
      .mockResolvedValueOnce({ replayEvidenceHash: "aa".repeat(32) } as any)
      .mockRejectedValue(new Error("cryptographic proof rejected"));
    const value = fixture();
    const result = await runTonProofFixtureCorruptionMatrix(
      value.raw,
      value.artifacts,
    );
    expect(result).toMatchObject({
      kind: "TON_PROOF_FIXTURE_CORRUPTION_MATRIX",
      baselineReplayVerified: true,
      manifestRehashedForEachMutation: true,
      everyMutationRejected: true,
      authorizationAllowed: false,
      caseCount: TON_PROOF_FIXTURE_ARTIFACT_NAMES.length,
    });
    expect(result.cases.map((item) => item.artifact)).toEqual(
      TON_PROOF_FIXTURE_ARTIFACT_NAMES,
    );
    expect(result.cases.every((item) => item.bitMask === 1)).toBe(true);
    expect(
      result.cases.find(
        (item) => item.artifact === "official-global-config.json",
      ),
    ).toMatchObject({ rejectionClass: "TonProofFixtureManifestError" });
    expect(result.matrixEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(replayTonProofFixtureOffline).toHaveBeenCalledTimes(
      TON_PROOF_FIXTURE_ARTIFACT_NAMES.length,
    );
  });

  it("fails the gate if any rehashed one-bit mutation is accepted", async () => {
    jest
      .mocked(replayTonProofFixtureOffline)
      .mockResolvedValue({ replayEvidenceHash: "aa".repeat(32) } as any);
    const value = fixture();
    await expect(
      runTonProofFixtureCorruptionMatrix(value.raw, value.artifacts),
    ).rejects.toThrow(TonProofFixtureCorruptionMatrixError);
    await expect(
      runTonProofFixtureCorruptionMatrix(value.raw, value.artifacts),
    ).rejects.toThrow("one-bit corruption was accepted");
  });
});
