import { createHash } from "crypto";
import { Address, CellType } from "@ton/core";
import type { TonProvenActiveAccountState } from "./ton-account-state-proof";
import type { TonVerifiedLocalWalletGetterResult } from "./ton-local-wallet-getter";
import type { TonProofBlockId } from "./ton-proof-envelope";

const HASH = /^[0-9a-f]{64}$/;

export interface TonProvenWalletCompositionExpectation {
  ownerAddress: string;
  masterAddress: string;
  candidateWalletAddress: string;
  pinnedWalletCodeHash: string;
}

export interface TonProvenCanonicalWalletComposition {
  kind: "TON_PROVEN_CANONICAL_WALLET_COMPOSITION";
  localGetterExecutionVerified: true;
  canonicalWalletAddressVerified: true;
  walletAccountStateProofVerified: true;
  walletIdentityVerified: true;
  walletDataVerified: true;
  activeCodeHashVerified: true;
  embeddedCodeHashVerified: true;
  sealPreconditionsVerified: true;
  sealingAuthorized: false;
  authorizationAllowed: false;
  verificationEvidenceHash: null;
  networkGlobalId: number;
  finalizedByMasterchainBlock: TonProofBlockId;
  walletAccountBlock: TonProofBlockId;
  ownerAddress: string;
  masterAddress: string;
  walletAddress: string;
  jettonBalance: string;
  walletCodeHash: string;
  walletDataHash: string;
  walletAccountStateHash: string;
  walletAccountProofBocHash: string;
  walletShardStateProofRootHash: string;
  walletLastTransactionHash: string;
  walletLastTransactionLt: string;
  localGetterTranscriptHash: string;
  proofCompositionHash: string;
}

export class TonProvenWalletCompositionError extends Error {
  readonly name = "TonProvenWalletCompositionError";
}

function reject(message: string): never {
  throw new TonProvenWalletCompositionError(message);
}

function parseRawAddress(value: string, label: string): Address {
  if (!/^-?\d+:[0-9a-f]{64}$/.test(value)) {
    reject(`${label} must be canonical raw lowercase form`);
  }
  try {
    const address = Address.parseRaw(value);
    if (address.toRawString() !== value) reject(`${label} is not canonical`);
    return address;
  } catch (error) {
    if (error instanceof TonProvenWalletCompositionError) throw error;
    reject(`${label} is invalid`);
  }
}

function requireHash(value: string, label: string): void {
  if (!HASH.test(value) || value === "0".repeat(64)) {
    reject(`${label} is invalid`);
  }
}

function blockIdsEqual(left: TonProofBlockId, right: TonProofBlockId): boolean {
  return (
    left.workchain === right.workchain &&
    left.shard === right.shard &&
    left.seqno === right.seqno &&
    left.rootHash === right.rootHash &&
    left.fileHash === right.fileHash
  );
}

function compositionHash(parts: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update("TON_PROVEN_CANONICAL_WALLET_COMPOSITION_V1", "utf8");
  for (const part of parts) {
    const value = Buffer.from(part, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    hash.update(length);
    hash.update(value);
  }
  return hash.digest("hex");
}

export function composeTonProvenCanonicalWallet(
  getter: TonVerifiedLocalWalletGetterResult,
  wallet: TonProvenActiveAccountState,
  expectation: TonProvenWalletCompositionExpectation,
): TonProvenCanonicalWalletComposition {
  if (
    getter.masterAccountStateProofVerified !== true ||
    getter.tvmEnvironmentProofVerified !== true ||
    getter.localGetterExecutionVerified !== true ||
    getter.canonicalWalletAddressVerified !== true ||
    getter.authorizationAllowed !== false ||
    getter.verificationEvidenceHash !== null
  ) {
    reject("local-getter provenance is invalid");
  }
  if (
    wallet.shardBlockFinalityProven !== true ||
    wallet.shardStateProofVerified !== true ||
    wallet.accountDictionaryInclusionVerified !== true ||
    wallet.accountStateProofVerified !== true ||
    wallet.transactionInclusionVerified !== false ||
    wallet.authorizationAllowed !== false ||
    wallet.verificationEvidenceHash !== null
  ) {
    reject("wallet-account proof provenance is invalid");
  }
  requireHash(expectation.pinnedWalletCodeHash, "pinnedWalletCodeHash");
  requireHash(getter.executionTranscriptHash, "local getter transcript hash");
  requireHash(getter.finalizedByMasterchainBlock.rootHash, "finalized root hash");
  requireHash(getter.finalizedByMasterchainBlock.fileHash, "finalized file hash");
  requireHash(wallet.block.rootHash, "wallet block root hash");
  requireHash(wallet.block.fileHash, "wallet block file hash");
  requireHash(wallet.shardStateProofRootHash, "wallet state proof root hash");
  requireHash(wallet.accountProofBocHash, "wallet account proof BOC hash");
  requireHash(wallet.lastTransactionHash, "wallet last transaction hash");
  const owner = parseRawAddress(expectation.ownerAddress, "ownerAddress");
  const master = parseRawAddress(expectation.masterAddress, "masterAddress");
  const candidate = parseRawAddress(
    expectation.candidateWalletAddress,
    "candidateWalletAddress",
  );
  if (
    getter.ownerAddress !== owner.toRawString() ||
    getter.masterAddress !== master.toRawString() ||
    getter.canonicalWalletAddress !== candidate.toRawString()
  ) {
    reject("local getter result does not match the seal expectation");
  }
  if (
    getter.networkGlobalId !== wallet.networkGlobalId ||
    !blockIdsEqual(
      getter.finalizedByMasterchainBlock,
      wallet.finalizedByMasterchainBlock,
    )
  ) {
    reject("local getter and wallet account use different finalized anchors");
  }
  if (wallet.accountAddress !== candidate.toRawString()) {
    reject("proven wallet account address does not match the canonical wallet");
  }
  if (
    wallet.accountStateRoot.hash(0).toString("hex") !== wallet.accountStateHash ||
    wallet.code.hash(0).toString("hex") !== wallet.codeHash ||
    wallet.data.hash(0).toString("hex") !== wallet.dataHash
  ) {
    reject("wallet-account cells no longer match their proven hashes");
  }
  if (wallet.code.type !== CellType.Ordinary || wallet.data.type !== CellType.Ordinary) {
    reject("wallet code and data must be ordinary cells");
  }
  if (wallet.codeHash !== expectation.pinnedWalletCodeHash) {
    reject("active wallet code hash does not match the pinned code hash");
  }

  try {
    const data = wallet.data.beginParse();
    const jettonBalance = data.loadCoins();
    const storedOwner = data.loadAddress();
    const storedMaster = data.loadAddress();
    const embeddedWalletCode = data.loadRef();
    data.endParse();
    if (!storedOwner.equals(owner)) reject("wallet owner does not match escrow");
    if (!storedMaster.equals(master)) reject("wallet master does not match allowlist");
    if (embeddedWalletCode.type !== CellType.Ordinary) {
      reject("embedded wallet code must be an ordinary cell");
    }
    const embeddedCodeHash = embeddedWalletCode.hash(0).toString("hex");
    if (
      embeddedCodeHash !== wallet.codeHash ||
      embeddedCodeHash !== expectation.pinnedWalletCodeHash
    ) {
      reject("embedded wallet code does not match active and pinned code");
    }
    const proofCompositionHash = compositionHash([
      getter.networkGlobalId.toString(),
      getter.finalizedByMasterchainBlock.workchain.toString(),
      getter.finalizedByMasterchainBlock.shard,
      getter.finalizedByMasterchainBlock.seqno.toString(),
      getter.finalizedByMasterchainBlock.rootHash,
      getter.finalizedByMasterchainBlock.fileHash,
      getter.executionTranscriptHash,
      wallet.block.workchain.toString(),
      wallet.block.shard,
      wallet.block.seqno.toString(),
      wallet.block.rootHash,
      wallet.block.fileHash,
      wallet.shardStateProofRootHash,
      wallet.accountProofBocHash,
      wallet.accountStateHash,
      wallet.codeHash,
      wallet.dataHash,
      wallet.lastTransactionHash,
      wallet.lastTransactionLt,
      owner.toRawString(),
      master.toRawString(),
      candidate.toRawString(),
      jettonBalance.toString(),
    ]);
    return {
      kind: "TON_PROVEN_CANONICAL_WALLET_COMPOSITION",
      localGetterExecutionVerified: true,
      canonicalWalletAddressVerified: true,
      walletAccountStateProofVerified: true,
      walletIdentityVerified: true,
      walletDataVerified: true,
      activeCodeHashVerified: true,
      embeddedCodeHashVerified: true,
      sealPreconditionsVerified: true,
      sealingAuthorized: false,
      authorizationAllowed: false,
      verificationEvidenceHash: null,
      networkGlobalId: wallet.networkGlobalId,
      finalizedByMasterchainBlock: { ...wallet.finalizedByMasterchainBlock },
      walletAccountBlock: { ...wallet.block },
      ownerAddress: owner.toRawString(),
      masterAddress: master.toRawString(),
      walletAddress: candidate.toRawString(),
      jettonBalance: jettonBalance.toString(),
      walletCodeHash: wallet.codeHash,
      walletDataHash: wallet.dataHash,
      walletAccountStateHash: wallet.accountStateHash,
      walletAccountProofBocHash: wallet.accountProofBocHash,
      walletShardStateProofRootHash: wallet.shardStateProofRootHash,
      walletLastTransactionHash: wallet.lastTransactionHash,
      walletLastTransactionLt: wallet.lastTransactionLt,
      localGetterTranscriptHash: getter.executionTranscriptHash,
      proofCompositionHash,
    };
  } catch (error) {
    if (error instanceof TonProvenWalletCompositionError) throw error;
    reject(
      `wallet data is malformed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
