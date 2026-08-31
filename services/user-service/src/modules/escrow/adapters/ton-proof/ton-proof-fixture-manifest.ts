import { createHash } from "crypto";
import type { TonProofBlockId, TonProofNetwork } from "./ton-proof-envelope";
import {
  isTonJettonWalletContractProfile,
  type TonJettonWalletContractProfile,
} from "./ton-jetton-wallet-profile";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RAW_ADDRESS_PATTERN = /^0:[0-9a-f]{64}$/;
const UINT64_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const MASTERCHAIN_SHARD = "-9223372036854775808";
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 64 * 1024 * 1024;

const NETWORKS = {
  mainnet: {
    globalId: -239,
    configUrl: "https://ton.org/global.config.json",
    zeroStateRootHash:
      "17a3a92992aabea785a7a090985a265cd31f323d849da51239737e321fb05569",
    zeroStateFileHash:
      "5e994fcf4d425c0a6ce6a792594b7173205f740a39cd56f537defd28b48a0f6e",
  },
  testnet: {
    globalId: -3,
    configUrl: "https://ton.org/testnet-global.config.json",
    zeroStateRootHash:
      "823f81f306ff02694f935cf5021548e3ce2b86b529812af6a12148879e95a128",
    zeroStateFileHash:
      "67e20ac184b9e039a62667acc3f9c00f90f359a76738233379efa47604980ce8",
  },
} as const;

export const TON_PROOF_FIXTURE_ARTIFACT_NAMES = [
  "checkpoint-proof.tl",
  "master-account-proof.boc",
  "master-account-shard-header-proof.boc",
  "master-account-state.boc",
  "masterchain-config-proof.boc",
  "masterchain-header-proof.boc",
  "masterchain-shards-data.boc",
  "official-global-config.json",
  "transaction-inclusion-proof.boc",
  "transaction.boc",
  "wallet-account-proof.boc",
  "wallet-account-shard-header-proof.boc",
  "wallet-account-state.boc",
] as const;

export type TonProofFixtureArtifactName =
  (typeof TON_PROOF_FIXTURE_ARTIFACT_NAMES)[number];

export interface TonProofFixtureLastTransaction {
  lt: string;
  hash: string;
}

export interface TonProofFixtureManifest {
  schemaVersion: 2;
  kind: "TON_CAPTURED_PROOF_FIXTURE";
  network: TonProofNetwork;
  globalId: number;
  capturedAtUnix: number;
  source: {
    globalConfigUrl: string;
    liteServerCount: number;
    captureTool: "scripts/capture-ton-proof-fixture.ts";
  };
  zeroState: TonProofBlockId;
  trustedKeyBlock: TonProofBlockId;
  targetMasterchainBlock: TonProofBlockId;
  masterAddress: string;
  ownerAddress: string;
  walletAddress: string;
  walletCodeHash: string;
  walletContractProfile: TonJettonWalletContractProfile;
  masterShardBlock: TonProofBlockId;
  walletShardBlock: TonProofBlockId;
  masterLastTransaction: TonProofFixtureLastTransaction | null;
  walletLastTransaction: TonProofFixtureLastTransaction | null;
  selectedShardTransaction: TonProofFixtureLastTransaction & {
    accountAddress: string;
  };
  artifacts: Record<
    TonProofFixtureArtifactName,
    { bytes: number; sha256: string }
  >;
}

export interface TonVerifiedProofFixture {
  kind: "TON_VERIFIED_PROOF_FIXTURE_MANIFEST";
  manifestVerified: true;
  artifactSetVerified: true;
  networkIdentityVerified: true;
  replayPerformed: false;
  authorizationAllowed: false;
  manifest: TonProofFixtureManifest;
  manifestHash: string;
  artifactSetHash: string;
  artifacts: Readonly<Record<TonProofFixtureArtifactName, Buffer>>;
}

export class TonProofFixtureManifestError extends Error {
  readonly name = "TonProofFixtureManifestError";
}

function reject(message: string): never {
  throw new TonProofFixtureManifestError(message);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) reject(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    reject(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    reject(`${label} is out of range`);
  }
  return value;
}

function nonzeroHash(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !HASH_PATTERN.test(value) ||
    value === "0".repeat(64)
  ) {
    reject(`${label} is invalid`);
  }
  return value;
}

function blockId(value: unknown, label: string): TonProofBlockId {
  const source = exactRecord(
    value,
    ["workchain", "shard", "seqno", "rootHash", "fileHash"],
    label,
  );
  const workchain = integer(source.workchain, -1, 0, `${label}.workchain`);
  if (
    typeof source.shard !== "string" ||
    !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(source.shard)
  ) {
    reject(`${label}.shard is not canonical`);
  }
  let shard: bigint;
  try {
    shard = BigInt(source.shard);
  } catch {
    reject(`${label}.shard is invalid`);
  }
  if (shard < -(1n << 63n) || shard > (1n << 63n) - 1n) {
    reject(`${label}.shard is outside int64`);
  }
  return {
    workchain,
    shard: source.shard,
    seqno: integer(source.seqno, 0, 0xffffffff, `${label}.seqno`),
    rootHash: nonzeroHash(source.rootHash, `${label}.rootHash`),
    fileHash: nonzeroHash(source.fileHash, `${label}.fileHash`),
  };
}

function rawAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !RAW_ADDRESS_PATTERN.test(value)) {
    reject(`${label} is not a canonical basechain address`);
  }
  return value;
}

function lastTransaction(
  value: unknown,
  label: string,
): TonProofFixtureLastTransaction | null {
  if (value === null) return null;
  const source = exactRecord(value, ["lt", "hash"], label);
  if (typeof source.lt !== "string" || !UINT64_PATTERN.test(source.lt)) {
    reject(`${label}.lt is not a canonical uint64`);
  }
  const lt = BigInt(source.lt);
  if (lt > (1n << 64n) - 1n) reject(`${label}.lt is outside uint64`);
  return { lt: source.lt, hash: nonzeroHash(source.hash, `${label}.hash`) };
}

function parseManifest(raw: Buffer): TonProofFixtureManifest {
  if (raw.length === 0 || raw.length > MAX_MANIFEST_BYTES) {
    reject("manifest byte length is out of range");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    reject("manifest is not valid UTF-8 JSON");
  }
  const source = exactRecord(
    parsed,
    [
      "schemaVersion",
      "kind",
      "network",
      "globalId",
      "capturedAtUnix",
      "source",
      "zeroState",
      "trustedKeyBlock",
      "targetMasterchainBlock",
      "masterAddress",
      "ownerAddress",
      "walletAddress",
      "walletCodeHash",
      "walletContractProfile",
      "masterShardBlock",
      "walletShardBlock",
      "masterLastTransaction",
      "walletLastTransaction",
      "selectedShardTransaction",
      "artifacts",
    ],
    "manifest",
  );
  if (source.schemaVersion !== 2) reject("schemaVersion is unsupported");
  if (source.kind !== "TON_CAPTURED_PROOF_FIXTURE") {
    reject("manifest kind is invalid");
  }
  if (source.network !== "mainnet" && source.network !== "testnet") {
    reject("manifest network is invalid");
  }
  const network = NETWORKS[source.network];
  const globalId = integer(
    source.globalId,
    -0x80000000,
    0x7fffffff,
    "globalId",
  );
  if (globalId !== network.globalId) reject("network global ID is not pinned");
  const capturedAtUnix = integer(
    source.capturedAtUnix,
    1,
    Number.MAX_SAFE_INTEGER,
    "capturedAtUnix",
  );
  const captureSource = exactRecord(
    source.source,
    ["globalConfigUrl", "liteServerCount", "captureTool"],
    "source",
  );
  if (captureSource.globalConfigUrl !== network.configUrl) {
    reject("global config URL is not pinned");
  }
  if (captureSource.captureTool !== "scripts/capture-ton-proof-fixture.ts") {
    reject("capture tool identity is invalid");
  }
  const liteServerCount = integer(
    captureSource.liteServerCount,
    2,
    64,
    "source.liteServerCount",
  );
  const zeroState = blockId(source.zeroState, "zeroState");
  if (
    zeroState.workchain !== -1 ||
    zeroState.shard !== MASTERCHAIN_SHARD ||
    zeroState.seqno !== 0 ||
    zeroState.rootHash !== network.zeroStateRootHash ||
    zeroState.fileHash !== network.zeroStateFileHash
  ) {
    reject("zerostate identity is not pinned for the network");
  }
  const trustedKeyBlock = blockId(source.trustedKeyBlock, "trustedKeyBlock");
  const targetMasterchainBlock = blockId(
    source.targetMasterchainBlock,
    "targetMasterchainBlock",
  );
  if (
    trustedKeyBlock.workchain !== -1 ||
    trustedKeyBlock.shard !== MASTERCHAIN_SHARD ||
    targetMasterchainBlock.workchain !== -1 ||
    targetMasterchainBlock.shard !== MASTERCHAIN_SHARD ||
    trustedKeyBlock.seqno === 0 ||
    targetMasterchainBlock.seqno <= trustedKeyBlock.seqno
  ) {
    reject("masterchain checkpoint range is invalid");
  }
  const masterShardBlock = blockId(source.masterShardBlock, "masterShardBlock");
  const walletShardBlock = blockId(source.walletShardBlock, "walletShardBlock");
  if (
    masterShardBlock.workchain !== 0 ||
    walletShardBlock.workchain !== 0 ||
    masterShardBlock.seqno === 0 ||
    walletShardBlock.seqno === 0
  ) {
    reject("account shard block identity is invalid");
  }
  const selected = exactRecord(
    source.selectedShardTransaction,
    ["accountAddress", "lt", "hash"],
    "selectedShardTransaction",
  );
  const selectedTransaction = lastTransaction(
    { lt: selected.lt, hash: selected.hash },
    "selectedShardTransaction",
  );
  if (!selectedTransaction) reject("selected transaction is absent");
  if (!isTonJettonWalletContractProfile(source.walletContractProfile)) {
    reject("walletContractProfile is unsupported");
  }

  const artifactSource = exactRecord(
    source.artifacts,
    TON_PROOF_FIXTURE_ARTIFACT_NAMES,
    "artifacts",
  );
  const artifacts = {} as TonProofFixtureManifest["artifacts"];
  for (const name of TON_PROOF_FIXTURE_ARTIFACT_NAMES) {
    const descriptor = exactRecord(
      artifactSource[name],
      ["bytes", "sha256"],
      `artifacts.${name}`,
    );
    artifacts[name] = {
      bytes: integer(
        descriptor.bytes,
        1,
        MAX_ARTIFACT_BYTES,
        `artifacts.${name}.bytes`,
      ),
      sha256: nonzeroHash(
        descriptor.sha256,
        `artifacts.${name}.sha256`,
      ),
    };
  }

  return {
    schemaVersion: 2,
    kind: "TON_CAPTURED_PROOF_FIXTURE",
    network: source.network,
    globalId,
    capturedAtUnix,
    source: {
      globalConfigUrl: network.configUrl,
      liteServerCount,
      captureTool: "scripts/capture-ton-proof-fixture.ts",
    },
    zeroState,
    trustedKeyBlock,
    targetMasterchainBlock,
    masterAddress: rawAddress(source.masterAddress, "masterAddress"),
    ownerAddress: rawAddress(source.ownerAddress, "ownerAddress"),
    walletAddress: rawAddress(source.walletAddress, "walletAddress"),
    walletCodeHash: nonzeroHash(source.walletCodeHash, "walletCodeHash"),
    walletContractProfile: source.walletContractProfile,
    masterShardBlock,
    walletShardBlock,
    masterLastTransaction: lastTransaction(
      source.masterLastTransaction,
      "masterLastTransaction",
    ),
    walletLastTransaction: lastTransaction(
      source.walletLastTransaction,
      "walletLastTransaction",
    ),
    selectedShardTransaction: {
      accountAddress: rawAddress(
        selected.accountAddress,
        "selectedShardTransaction.accountAddress",
      ),
      ...selectedTransaction,
    },
    artifacts,
  };
}

function canonicalBase64Hash(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length !== 44) {
    reject(`${label} is not a base64 hash`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    reject(`${label} is not canonical base64`);
  }
  return decoded.toString("hex");
}

function validateOfficialGlobalConfig(
  raw: Buffer,
  manifest: TonProofFixtureManifest,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    reject("official global config is not valid JSON");
  }
  if (!isRecord(parsed)) reject("official global config must be an object");
  const validator = isRecord(parsed.validator) ? parsed.validator : null;
  const zeroState = validator && isRecord(validator.zero_state)
    ? validator.zero_state
    : null;
  if (!zeroState) reject("official global config has no zerostate");
  if (zeroState.workchain !== -1 || zeroState.seqno !== 0) {
    reject("official global config zerostate metadata is invalid");
  }
  if (
    canonicalBase64Hash(zeroState.root_hash, "config zerostate root") !==
      manifest.zeroState.rootHash ||
    canonicalBase64Hash(zeroState.file_hash, "config zerostate file") !==
      manifest.zeroState.fileHash
  ) {
    reject("official global config zerostate does not match the manifest");
  }
  if (
    !Array.isArray(parsed.liteservers) ||
    parsed.liteservers.length !== manifest.source.liteServerCount
  ) {
    reject("official global config LiteServer count does not match the manifest");
  }
  const identities = new Set<string>();
  parsed.liteservers.forEach((value, index) => {
    if (!isRecord(value) || !isRecord(value.id)) {
      reject(`official global config liteservers[${index}] is malformed`);
    }
    integer(
      value.ip,
      -0x80000000,
      0x7fffffff,
      `config liteservers[${index}].ip`,
    );
    integer(value.port, 1, 65535, `config liteservers[${index}].port`);
    if (value.id["@type"] !== "pub.ed25519") {
      reject(`config liteservers[${index}] key type is unsupported`);
    }
    const key = canonicalBase64Hash(
      value.id.key,
      `config liteservers[${index}].key`,
    );
    if (identities.has(key)) reject("official global config has duplicate LiteServers");
    identities.add(key);
  });
}

export function verifyTonProofFixtureManifest(
  rawManifest: Buffer,
  suppliedArtifacts: Readonly<Record<string, Buffer>>,
): TonVerifiedProofFixture {
  const manifest = parseManifest(rawManifest);
  const actualNames = Object.keys(suppliedArtifacts).sort();
  const expectedNames = [...TON_PROOF_FIXTURE_ARTIFACT_NAMES].sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    reject("supplied artifact set is not exact");
  }
  let totalBytes = 0;
  const artifacts = {} as Record<TonProofFixtureArtifactName, Buffer>;
  for (const name of TON_PROOF_FIXTURE_ARTIFACT_NAMES) {
    const value = suppliedArtifacts[name];
    if (!Buffer.isBuffer(value)) reject(`${name} is not a Buffer`);
    const descriptor = manifest.artifacts[name];
    if (value.length !== descriptor.bytes) reject(`${name} byte length mismatch`);
    if (sha256(value) !== descriptor.sha256) reject(`${name} hash mismatch`);
    totalBytes += value.length;
    if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
      reject("artifact set exceeds the total byte limit");
    }
    artifacts[name] = Buffer.from(value);
  }
  validateOfficialGlobalConfig(
    artifacts["official-global-config.json"],
    manifest,
  );
  const artifactSetHash = sha256(
    JSON.stringify({
      domain: "telegram-garant/ton-proof-fixture-artifact-set/v1",
      network: manifest.network,
      targetMasterchainBlock: manifest.targetMasterchainBlock,
      artifacts: TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((name) => ({
        name,
        ...manifest.artifacts[name],
      })),
    }),
  );
  return {
    kind: "TON_VERIFIED_PROOF_FIXTURE_MANIFEST",
    manifestVerified: true,
    artifactSetVerified: true,
    networkIdentityVerified: true,
    replayPerformed: false,
    authorizationAllowed: false,
    manifest,
    manifestHash: sha256(rawManifest),
    artifactSetHash,
    artifacts,
  };
}
