import { createHash } from "crypto";
import { beginCell } from "@ton/core";
import { verifyTonAccountStateProof } from "./ton-account-state-proof";
import { verifyTonMasterchainCheckpointChain } from "./ton-checkpoint-chain";
import { executeTonCanonicalWalletGetter } from "./ton-local-wallet-getter";
import { verifyTonMasterchainHeaderCell } from "./ton-masterchain-header-proof";
import { TON_PROOF_FIXTURE_ARTIFACT_NAMES } from "./ton-proof-fixture-manifest";
import { replayTonProofFixtureOffline } from "./ton-proof-fixture-replay";
import { parseTonMerkleProofBoc } from "./ton-proof-envelope";
import { composeTonProvenCanonicalWallet } from "./ton-proven-wallet-composition";
import { verifyTonShardBlockProof } from "./ton-shard-block-proof";
import { verifyTonShardDescriptorProof } from "./ton-shard-descriptor-proof";
import { verifyTonTransactionInclusionProof } from "./ton-transaction-inclusion-proof";
import { verifyTonTvmEnvironmentProof } from "./ton-tvm-environment-proof";

jest.mock("./ton-account-state-proof", () => ({
  verifyTonAccountStateProof: jest.fn(),
}));
jest.mock("./ton-checkpoint-chain", () => ({
  verifyTonMasterchainCheckpointChain: jest.fn(),
}));
jest.mock("./ton-local-wallet-getter", () => ({
  executeTonCanonicalWalletGetter: jest.fn(),
}));
jest.mock("./ton-masterchain-header-proof", () => ({
  verifyTonMasterchainHeaderCell: jest.fn(),
}));
jest.mock("./ton-proof-envelope", () => ({
  parseTonMerkleProofBoc: jest.fn(),
}));
jest.mock("./ton-proven-wallet-composition", () => ({
  composeTonProvenCanonicalWallet: jest.fn(),
}));
jest.mock("./ton-shard-block-proof", () => ({
  verifyTonShardBlockProof: jest.fn(),
}));
jest.mock("./ton-shard-descriptor-proof", () => ({
  verifyTonShardDescriptorProof: jest.fn(),
}));
jest.mock("./ton-transaction-inclusion-proof", () => ({
  verifyTonTransactionInclusionProof: jest.fn(),
}));
jest.mock("./ton-tvm-environment-proof", () => ({
  verifyTonTvmEnvironmentProof: jest.fn(),
}));

const MC_SHARD = "-9223372036854775808";
const target = {
  workchain: -1,
  shard: MC_SHARD,
  seqno: 101,
  rootHash: "22".repeat(32),
  fileHash: "23".repeat(32),
};
const masterShard = {
  workchain: 0,
  shard: MC_SHARD,
  seqno: 200,
  rootHash: "33".repeat(32),
  fileHash: "34".repeat(32),
};
const walletShard = {
  workchain: 0,
  shard: MC_SHARD,
  seqno: 201,
  rootHash: "44".repeat(32),
  fileHash: "45".repeat(32),
};

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const artifacts = Object.fromEntries(
    TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((name, index) => [
      name,
      Buffer.from(`offline:${index}:${name}`),
    ]),
  ) as Record<string, Buffer>;
  artifacts["official-global-config.json"] = Buffer.from(
    JSON.stringify({
      validator: {
        zero_state: {
          workchain: -1,
          shard: -9223372036854776000,
          seqno: 0,
          root_hash: Buffer.from(
            "17a3a92992aabea785a7a090985a265cd31f323d849da51239737e321fb05569",
            "hex",
          ).toString("base64"),
          file_hash: Buffer.from(
            "5e994fcf4d425c0a6ce6a792594b7173205f740a39cd56f537defd28b48a0f6e",
            "hex",
          ).toString("base64"),
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
      rootHash:
        "17a3a92992aabea785a7a090985a265cd31f323d849da51239737e321fb05569",
      fileHash:
        "5e994fcf4d425c0a6ce6a792594b7173205f740a39cd56f537defd28b48a0f6e",
    },
    trustedKeyBlock: {
      ...target,
      seqno: 100,
      rootHash: "11".repeat(32),
      fileHash: "12".repeat(32),
    },
    targetMasterchainBlock: target,
    masterAddress: `0:${"51".repeat(32)}`,
    ownerAddress: `0:${"52".repeat(32)}`,
    walletAddress: `0:${"53".repeat(32)}`,
    walletCodeHash: "54".repeat(32),
    walletContractProfile: "tep74-reference-wallet-v1",
    masterShardBlock: masterShard,
    walletShardBlock: walletShard,
    masterLastTransaction: null,
    walletLastTransaction: null,
    selectedShardTransaction: {
      accountAddress: `0:${"55".repeat(32)}`,
      lt: "3000",
      hash: "56".repeat(32),
    },
    artifacts: Object.fromEntries(
      TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((name) => [
        name,
        { bytes: artifacts[name].length, sha256: sha256(artifacts[name]) },
      ]),
    ),
  };
  return { raw: Buffer.from(JSON.stringify(manifest)), artifacts, manifest };
}

function installSuccessfulProofMocks(): void {
  jest.mocked(verifyTonMasterchainCheckpointChain).mockReturnValue({
    targetGeneratedAtUnix: 1_799_999_990,
    checkpointEvidenceHash: "61".repeat(32),
  } as any);
  jest.mocked(parseTonMerkleProofBoc).mockReturnValue({
    virtualRoot: beginCell().endCell(),
  } as any);
  jest.mocked(verifyTonMasterchainHeaderCell).mockReturnValue({
    generatedAtUnix: 1_799_999_990,
  } as any);
  jest
    .mocked(verifyTonShardDescriptorProof)
    .mockReturnValueOnce({ block: masterShard } as any)
    .mockReturnValueOnce({ block: walletShard } as any);
  jest
    .mocked(verifyTonShardBlockProof)
    .mockReturnValueOnce({ block: masterShard } as any)
    .mockReturnValueOnce({ block: walletShard } as any);
  jest
    .mocked(verifyTonAccountStateProof)
    .mockReturnValueOnce({ accountStateHash: "62".repeat(32) } as any)
    .mockReturnValueOnce({ accountStateHash: "63".repeat(32) } as any);
  jest.mocked(verifyTonTvmEnvironmentProof).mockReturnValue({} as any);
  jest.mocked(executeTonCanonicalWalletGetter).mockResolvedValue({
    executionTranscriptHash: "64".repeat(32),
  } as any);
  jest.mocked(composeTonProvenCanonicalWallet).mockReturnValue({
    proofCompositionHash: "65".repeat(32),
  } as any);
  jest.mocked(verifyTonTransactionInclusionProof).mockReturnValue({
    transactionHash: "56".repeat(32),
  } as any);
}

describe("TON offline proof fixture replay", () => {
  beforeEach(() => jest.clearAllMocks());

  it("re-verifies the manifest and composes every cryptographic stage without providers", async () => {
    installSuccessfulProofMocks();
    const value = fixture();
    const result = await replayTonProofFixtureOffline(value.raw, value.artifacts);
    expect(result).toMatchObject({
      kind: "TON_OFFLINE_PROOF_FIXTURE_REPLAY",
      manifestVerified: true,
      artifactSetVerified: true,
      masterchainFinalityProven: true,
      masterAccountStateVerified: true,
      walletAccountStateVerified: true,
      localGetterExecutionVerified: true,
      canonicalWalletCompositionVerified: true,
      transactionInclusionVerified: true,
      providersUsed: false,
      networkAccessUsed: false,
      authorizationAllowed: false,
      network: "mainnet",
      targetMasterchainBlock: target,
    });
    expect(result.replayEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTonMasterchainCheckpointChain).toHaveBeenCalledTimes(1);
    expect(verifyTonShardDescriptorProof).toHaveBeenCalledTimes(2);
    expect(verifyTonAccountStateProof).toHaveBeenCalledTimes(2);
    expect(executeTonCanonicalWalletGetter).toHaveBeenCalledTimes(1);
    expect(verifyTonTransactionInclusionProof).toHaveBeenCalledTimes(1);
  });

  it("fails before any proof parser when an artifact changed after capture", async () => {
    const value = fixture();
    value.artifacts["checkpoint-proof.tl"][0] ^= 1;
    await expect(
      replayTonProofFixtureOffline(value.raw, value.artifacts),
    ).rejects.toThrow("checkpoint-proof.tl hash mismatch");
    expect(verifyTonMasterchainCheckpointChain).not.toHaveBeenCalled();
  });

  it("rejects disagreement between independently replayed target headers", async () => {
    installSuccessfulProofMocks();
    jest.mocked(verifyTonMasterchainHeaderCell).mockReturnValue({
      generatedAtUnix: 1_799_999_989,
    } as any);
    const value = fixture();
    await expect(
      replayTonProofFixtureOffline(value.raw, value.artifacts),
    ).rejects.toThrow("generation times differ");
  });

  it("rejects a shard descriptor that differs from the captured identity", async () => {
    installSuccessfulProofMocks();
    jest.mocked(verifyTonShardDescriptorProof).mockReset().mockReturnValue({
      block: { ...masterShard, seqno: 999 },
    } as any);
    const value = fixture();
    await expect(
      replayTonProofFixtureOffline(value.raw, value.artifacts),
    ).rejects.toThrow("master shard descriptor does not match the manifest");
  });
});
