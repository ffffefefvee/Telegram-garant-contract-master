import { createHash } from "crypto";
import { verifyTonAccountStateProof } from "./ton-account-state-proof";
import { verifyTonMasterchainCheckpointChain } from "./ton-checkpoint-chain";
import { executeTonCanonicalWalletGetter } from "./ton-local-wallet-getter";
import { verifyTonMasterchainHeaderCell } from "./ton-masterchain-header-proof";
import {
  verifyTonProofFixtureManifest,
  type TonProofFixtureArtifactName,
} from "./ton-proof-fixture-manifest";
import {
  parseTonMerkleProofBoc,
  type TonProofBlockId,
  type TonProofResourceLimits,
} from "./ton-proof-envelope";
import { composeTonProvenCanonicalWallet } from "./ton-proven-wallet-composition";
import { verifyTonShardBlockProof } from "./ton-shard-block-proof";
import { verifyTonShardDescriptorProof } from "./ton-shard-descriptor-proof";
import { verifyTonTransactionInclusionProof } from "./ton-transaction-inclusion-proof";
import { verifyTonTvmEnvironmentProof } from "./ton-tvm-environment-proof";

const BOC_LIMITS: TonProofResourceLimits = {
  maxBocBytes: 16 * 1024 * 1024,
  maxCells: 1_000_000,
  maxDepth: 1024,
};

function blockIdsEqual(left: TonProofBlockId, right: TonProofBlockId): boolean {
  return (
    left.workchain === right.workchain &&
    left.shard === right.shard &&
    left.seqno === right.seqno &&
    left.rootHash === right.rootHash &&
    left.fileHash === right.fileHash
  );
}

function requireBlock(
  actual: TonProofBlockId,
  expected: TonProofBlockId,
  label: string,
): void {
  if (!blockIdsEqual(actual, expected)) {
    throw new TonProofFixtureReplayError(`${label} does not match the manifest`);
  }
}

export interface TonOfflineProofFixtureReplay {
  kind: "TON_OFFLINE_PROOF_FIXTURE_REPLAY";
  manifestVerified: true;
  artifactSetVerified: true;
  masterchainFinalityProven: true;
  masterchainHeaderVerified: true;
  masterAccountStateVerified: true;
  walletAccountStateVerified: true;
  localGetterExecutionVerified: true;
  canonicalWalletCompositionVerified: true;
  transactionInclusionVerified: true;
  providersUsed: false;
  networkAccessUsed: false;
  authorizationAllowed: false;
  network: "mainnet" | "testnet";
  globalId: number;
  targetMasterchainBlock: TonProofBlockId;
  manifestHash: string;
  artifactSetHash: string;
  checkpointEvidenceHash: string;
  proofCompositionHash: string;
  transactionHash: string;
  replayEvidenceHash: string;
}

export class TonProofFixtureReplayError extends Error {
  readonly name = "TonProofFixtureReplayError";
}

export async function replayTonProofFixtureOffline(
  rawManifest: Buffer,
  suppliedArtifacts: Readonly<Record<string, Buffer>>,
): Promise<TonOfflineProofFixtureReplay> {
  const verified = verifyTonProofFixtureManifest(
    rawManifest,
    suppliedArtifacts,
  );
  const { manifest, artifacts } = verified;
  const chain = verifyTonMasterchainCheckpointChain(
    artifacts["checkpoint-proof.tl"].toString("base64"),
    {
      policyVersion: "ton-captured-fixture-replay-v1",
      globalId: manifest.globalId,
      trustedKeyBlock: manifest.trustedKeyBlock,
      targetBlock: manifest.targetMasterchainBlock,
      observedAtUnix: manifest.capturedAtUnix,
      nowUnix: manifest.capturedAtUnix,
      maxProofAgeSeconds: 30 * 24 * 60 * 60,
      maxFutureSkewSeconds: 300,
      liteLimits: {
        maxBytes: 16 * 1024 * 1024,
        maxLinks: 64,
        maxSignaturesPerLink: 4096,
        maxEmbeddedProofBytes: 16 * 1024 * 1024,
      },
      bocLimits: BOC_LIMITS,
    },
  );
  const headerProof = parseTonMerkleProofBoc(
    artifacts["masterchain-header-proof.boc"],
    BOC_LIMITS,
    "fixture_masterchain_header",
  );
  const header = verifyTonMasterchainHeaderCell(headerProof.virtualRoot, {
    globalId: manifest.globalId,
    targetBlock: manifest.targetMasterchainBlock,
    trustedKeyBlockSeqno: manifest.trustedKeyBlock.seqno,
  });
  if (chain.targetGeneratedAtUnix !== header.generatedAtUnix) {
    throw new TonProofFixtureReplayError(
      "checkpoint and standalone header generation times differ",
    );
  }

  const descriptorProof = artifacts["masterchain-config-proof.boc"];
  const descriptorData = artifacts["masterchain-shards-data.boc"];
  const masterDescriptor = verifyTonShardDescriptorProof(
    chain,
    header,
    descriptorProof,
    {
      workchain: 0,
      shard: manifest.masterShardBlock.shard,
      limits: BOC_LIMITS,
    },
    descriptorData,
  );
  requireBlock(
    masterDescriptor.block,
    manifest.masterShardBlock,
    "master shard descriptor",
  );
  const walletDescriptor = verifyTonShardDescriptorProof(
    chain,
    header,
    descriptorProof,
    {
      workchain: 0,
      shard: manifest.walletShardBlock.shard,
      limits: BOC_LIMITS,
    },
    descriptorData,
  );
  requireBlock(
    walletDescriptor.block,
    manifest.walletShardBlock,
    "wallet shard descriptor",
  );

  const masterShard = verifyTonShardBlockProof(
    masterDescriptor,
    artifacts["master-account-shard-header-proof.boc"],
    { limits: BOC_LIMITS },
  );
  const walletShard = verifyTonShardBlockProof(
    walletDescriptor,
    artifacts["wallet-account-shard-header-proof.boc"],
    { limits: BOC_LIMITS },
  );
  const masterAccount = verifyTonAccountStateProof(
    masterShard,
    artifacts["master-account-proof.boc"],
    artifacts["master-account-state.boc"],
    { accountAddress: manifest.masterAddress, limits: BOC_LIMITS },
  );
  const walletAccount = verifyTonAccountStateProof(
    walletShard,
    artifacts["wallet-account-proof.boc"],
    artifacts["wallet-account-state.boc"],
    { accountAddress: manifest.walletAddress, limits: BOC_LIMITS },
  );

  const environment = verifyTonTvmEnvironmentProof(
    chain,
    header,
    artifacts["masterchain-config-proof.boc"],
    { limits: BOC_LIMITS },
  );
  const getter = await executeTonCanonicalWalletGetter(
    masterAccount,
    environment,
    {
      masterAddress: manifest.masterAddress,
      ownerAddress: manifest.ownerAddress,
      candidateWalletAddress: manifest.walletAddress,
      walletContractProfile: manifest.walletContractProfile,
      gasLimit: 100_000_000n,
    },
  );
  const wallet = composeTonProvenCanonicalWallet(getter, walletAccount, {
    ownerAddress: manifest.ownerAddress,
    masterAddress: manifest.masterAddress,
    candidateWalletAddress: manifest.walletAddress,
    pinnedWalletCodeHash: manifest.walletCodeHash,
    walletContractProfile: manifest.walletContractProfile,
  });
  const transaction = verifyTonTransactionInclusionProof(
    walletShard,
    artifacts["transaction-inclusion-proof.boc"],
    artifacts["transaction.boc"],
    {
      accountAddress: manifest.selectedShardTransaction.accountAddress,
      transactionLt: manifest.selectedShardTransaction.lt,
      transactionHash: manifest.selectedShardTransaction.hash,
      limits: BOC_LIMITS,
    },
  );

  const evidence = {
    domain: "telegram-garant/ton-offline-proof-fixture-replay/v1",
    manifestHash: verified.manifestHash,
    artifactSetHash: verified.artifactSetHash,
    network: manifest.network,
    globalId: manifest.globalId,
    targetMasterchainBlock: manifest.targetMasterchainBlock,
    checkpointEvidenceHash: chain.checkpointEvidenceHash,
    masterAccountStateHash: masterAccount.accountStateHash,
    walletAccountStateHash: walletAccount.accountStateHash,
    localGetterTranscriptHash: getter.executionTranscriptHash,
    proofCompositionHash: wallet.proofCompositionHash,
    transactionHash: transaction.transactionHash,
  };
  return {
    kind: "TON_OFFLINE_PROOF_FIXTURE_REPLAY",
    manifestVerified: true,
    artifactSetVerified: true,
    masterchainFinalityProven: true,
    masterchainHeaderVerified: true,
    masterAccountStateVerified: true,
    walletAccountStateVerified: true,
    localGetterExecutionVerified: true,
    canonicalWalletCompositionVerified: true,
    transactionInclusionVerified: true,
    providersUsed: false,
    networkAccessUsed: false,
    authorizationAllowed: false,
    network: manifest.network,
    globalId: manifest.globalId,
    targetMasterchainBlock: { ...manifest.targetMasterchainBlock },
    manifestHash: verified.manifestHash,
    artifactSetHash: verified.artifactSetHash,
    checkpointEvidenceHash: chain.checkpointEvidenceHash,
    proofCompositionHash: wallet.proofCompositionHash,
    transactionHash: transaction.transactionHash,
    replayEvidenceHash: createHash("sha256")
      .update(JSON.stringify(evidence))
      .digest("hex"),
  };
}

export type TonOfflineReplayArtifactName = TonProofFixtureArtifactName;
