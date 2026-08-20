import type { TonProvenActiveAccountState } from "./ton-account-state-proof";
import type { TonVerifiedLocalWalletGetterResult } from "./ton-local-wallet-getter";
import {
  composeTonProvenCanonicalWallet,
  type TonProvenWalletCompositionExpectation,
} from "./ton-proven-wallet-composition";
import {
  commitTonVerificationEvidence,
  type TonVerificationEvidence,
  type TonVerificationEvidencePolicy,
} from "./ton-verification-evidence";

export function createTonWalletSealVerificationEvidence(
  getter: TonVerifiedLocalWalletGetterResult,
  wallet: TonProvenActiveAccountState,
  expectation: TonProvenWalletCompositionExpectation,
  policy: TonVerificationEvidencePolicy,
): TonVerificationEvidence {
  const proof = composeTonProvenCanonicalWallet(getter, wallet, expectation);
  return commitTonVerificationEvidence(
    {
      scope: "wallet_seal",
      networkGlobalId: proof.networkGlobalId,
      masterchainSeqno: proof.finalizedByMasterchainBlock.seqno,
      masterchainRootHash: proof.finalizedByMasterchainBlock.rootHash,
      masterchainFileHash: proof.finalizedByMasterchainBlock.fileHash,
      subjectId: proof.walletAddress,
      proofCompositionHash: proof.proofCompositionHash,
    },
    policy,
  );
}
