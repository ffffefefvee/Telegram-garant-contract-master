import type {
  TonVerificationEvidence,
  TonVerificationEvidencePolicy,
} from "../escrow/adapters/ton-proof/ton-verification-evidence";
import { commitTonVerificationEvidence } from "../escrow/adapters/ton-proof/ton-verification-evidence";
import {
  composeTonFinalizedJettonReconciliation,
  type TonJettonReconciliationFinalityProofs,
} from "./ton-finalized-jetton-reconciliation";
import type {
  TonJettonReconciliationExpectation,
  TonJettonReconciliationValidation,
} from "./ton-jetton-reconciliation-validator";

export function createTonSettlementVerificationEvidence(
  structural: TonJettonReconciliationValidation,
  expectation: TonJettonReconciliationExpectation,
  proofs: TonJettonReconciliationFinalityProofs,
  policy: TonVerificationEvidencePolicy,
): TonVerificationEvidence {
  const proof = composeTonFinalizedJettonReconciliation(
    structural,
    expectation,
    proofs,
  );
  return commitTonVerificationEvidence(
    {
      scope: "settlement_reconciliation",
      networkGlobalId: proof.networkGlobalId,
      masterchainSeqno: proof.finalizedByMasterchainBlock.seqno,
      masterchainRootHash: proof.finalizedByMasterchainBlock.rootHash,
      masterchainFileHash: proof.finalizedByMasterchainBlock.fileHash,
      subjectId: `${proof.settlementId}:${proof.leg}:${proof.attempt}`,
      proofCompositionHash: proof.finalityCompositionHash,
    },
    policy,
  );
}
