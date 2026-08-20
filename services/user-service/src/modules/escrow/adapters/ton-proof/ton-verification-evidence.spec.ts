import { generateKeyPairSync, sign } from "crypto";
import {
  approveTonVerificationEvidence,
  commitTonVerificationEvidence,
  tonEvidenceApprovalSigningPayload,
  TonVerificationEvidenceError,
  type TonEvidenceSignature,
  type TonThresholdApprovalPolicy,
  type TonVerificationEvidence,
  type TonVerificationEvidencePolicy,
  type TonVerificationEvidenceScope,
} from "./ton-verification-evidence";

function evidencePolicy(
  overrides: Partial<TonVerificationEvidencePolicy> = {},
): TonVerificationEvidencePolicy {
  return {
    schemaVersion: 1,
    policyId: "ton-testnet-proof-policy-v1",
    verifierVersion: "ton-proof-kernel-v1",
    networkGlobalId: -3,
    minimumMasterchainSeqno: 100,
    trustedNetworkConfigHash: "11".repeat(32),
    proofFixtureManifestHash: "22".repeat(32),
    independentReviewHash: "33".repeat(32),
    ...overrides,
  };
}

function commit(
  scope: TonVerificationEvidenceScope = "wallet_seal",
  policy = evidencePolicy(),
): TonVerificationEvidence {
  return commitTonVerificationEvidence(
    {
      scope,
      networkGlobalId: -3,
      masterchainSeqno: 120,
      masterchainRootHash: "44".repeat(32),
      masterchainFileHash: "55".repeat(32),
      subjectId:
        scope === "wallet_seal"
          ? `0:${"66".repeat(32)}`
          : "settlement-1:seller:1",
      proofCompositionHash: "77".repeat(32),
    },
    policy,
  );
}

function approvalFixture(evidence: TonVerificationEvidence) {
  const keys = ["operator-a", "operator-b", "operator-c"].map((signerId) => {
    const pair = generateKeyPairSync("ed25519");
    return {
      signerId,
      privateKey: pair.privateKey,
      publicKeySpkiDerBase64: pair.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    };
  });
  const policy: TonThresholdApprovalPolicy = {
    schemaVersion: 1,
    policyId: "ton-testnet-seal-approvers-v1",
    scope: evidence.scope,
    networkGlobalId: evidence.networkGlobalId,
    evidencePolicyHash: evidence.evidencePolicyHash,
    threshold: 2,
    signers: keys.map((key) => ({
      signerId: key.signerId,
      enabled: true,
      publicKeySpkiDerBase64: key.publicKeySpkiDerBase64,
    })),
  };
  const payload = tonEvidenceApprovalSigningPayload(
    evidence,
    evidencePolicy(),
    policy,
  );
  const signatures: TonEvidenceSignature[] = keys.map((key) => ({
    signerId: key.signerId,
    algorithm: "ed25519",
    signatureBase64: sign(null, payload, key.privateKey).toString("base64"),
  }));
  return { keys, policy, signatures };
}

describe("TON verification evidence and threshold approval", () => {
  it("emits a domain-separated proof commitment without authorization", () => {
    const evidence = commit();
    expect(evidence).toMatchObject({
      kind: "TON_VERIFICATION_EVIDENCE",
      proofVerificationSucceeded: true,
      evidencePolicyVerified: true,
      thresholdApprovalVerified: false,
      sealingAuthorized: false,
      settlementAuthorized: false,
      authorizationAllowed: false,
      scope: "wallet_seal",
      networkGlobalId: -3,
      remainingRequirement: "THRESHOLD_APPROVAL_REQUIRED",
    });
    expect(evidence.verificationEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.evidencePolicyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(commit().verificationEvidenceHash).toBe(
      evidence.verificationEvidenceHash,
    );
  });

  it("separates wallet-seal and settlement evidence domains", () => {
    expect(commit("settlement_reconciliation").verificationEvidenceHash).not.toBe(
      commit("wallet_seal").verificationEvidenceHash,
    );
  });

  it.each([
    ["network", { networkGlobalId: -239 }],
    ["stale anchor", { minimumMasterchainSeqno: 121 }],
    ["fixture manifest", { proofFixtureManifestHash: "0".repeat(64) }],
    ["review commitment", { independentReviewHash: "0".repeat(64) }],
  ])("rejects an invalid %s policy binding", (_label, overrides) => {
    expect(() => commit("wallet_seal", evidencePolicy(overrides))).toThrow(
      TonVerificationEvidenceError,
    );
  });

  it("accepts two valid signatures and authorizes only wallet sealing", () => {
    const evidence = commit();
    const fixture = approvalFixture(evidence);
    const approved = approveTonVerificationEvidence(
      evidence,
      evidencePolicy(),
      fixture.policy,
      fixture.signatures.slice(0, 2),
    );
    expect(approved).toMatchObject({
      kind: "TON_APPROVED_VERIFICATION_EVIDENCE",
      thresholdApprovalVerified: true,
      sealingAuthorized: true,
      settlementAuthorized: false,
      authorizationAllowed: true,
      approvalThreshold: 2,
      verifiedSigners: ["operator-a", "operator-b"],
    });
    expect(approved.approvalArtifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approved).not.toHaveProperty("remainingRequirement");
  });

  it("authorizes only settlement reconciliation for its distinct scope", () => {
    const evidence = commit("settlement_reconciliation");
    const fixture = approvalFixture(evidence);
    const approved = approveTonVerificationEvidence(
      evidence,
      evidencePolicy(),
      fixture.policy,
      fixture.signatures.slice(1),
    );
    expect(approved.sealingAuthorized).toBe(false);
    expect(approved.settlementAuthorized).toBe(true);
    expect(approved.authorizationAllowed).toBe(true);
  });

  it("rejects fewer signatures than the immutable threshold", () => {
    const evidence = commit();
    const fixture = approvalFixture(evidence);
    expect(() =>
      approveTonVerificationEvidence(evidence, evidencePolicy(), fixture.policy, [
        fixture.signatures[0],
      ]),
    ).toThrow("requires 2 signatures; verified 1");
  });

  it("rejects duplicate signatures", () => {
    const evidence = commit();
    const fixture = approvalFixture(evidence);
    expect(() =>
      approveTonVerificationEvidence(evidence, evidencePolicy(), fixture.policy, [
        fixture.signatures[0],
        fixture.signatures[0],
      ]),
    ).toThrow("duplicate approval signature");
  });

  it("rejects a signature over different evidence", () => {
    const evidence = commit();
    const fixture = approvalFixture(evidence);
    const altered = {
      ...evidence,
      subjectId: `0:${"88".repeat(32)}`,
      verificationEvidenceHash: "99".repeat(32),
    };
    expect(() =>
      approveTonVerificationEvidence(
        altered,
        evidencePolicy(),
        fixture.policy,
        fixture.signatures.slice(0, 2),
      ),
    ).toThrow("commitment does not match its policy");
  });

  it("rejects approval policy scope and network replay", () => {
    const evidence = commit();
    const fixture = approvalFixture(evidence);
    expect(() =>
      tonEvidenceApprovalSigningPayload(evidence, evidencePolicy(), {
        ...fixture.policy,
        scope: "settlement_reconciliation",
      }),
    ).toThrow("does not match verification evidence");
    expect(() =>
      tonEvidenceApprovalSigningPayload(evidence, evidencePolicy(), {
        ...fixture.policy,
        networkGlobalId: -239,
      }),
    ).toThrow("does not match verification evidence");
  });

  it("rejects unsorted and under-provisioned signer policies", () => {
    const evidence = commit();
    const fixture = approvalFixture(evidence);
    expect(() =>
      tonEvidenceApprovalSigningPayload(evidence, evidencePolicy(), {
        ...fixture.policy,
        signers: [...fixture.policy.signers].reverse(),
      }),
    ).toThrow("distinct and sorted");
    expect(() =>
      tonEvidenceApprovalSigningPayload(evidence, evidencePolicy(), {
        ...fixture.policy,
        signers: fixture.policy.signers.map((signer, index) => ({
          ...signer,
          enabled: index === 0,
        })),
      }),
    ).toThrow("fewer enabled signers");
  });

  it("rejects forged authorization provenance", () => {
    const evidence = commit();
    expect(() =>
      tonEvidenceApprovalSigningPayload(
        { ...evidence, authorizationAllowed: true as false },
        evidencePolicy(),
        approvalFixture(evidence).policy,
      ),
    ).toThrow("provenance is invalid");
  });

  it("rejects ambiguous policy, evidence and signature shapes", () => {
    expect(() =>
      commit(
        "wallet_seal",
        evidencePolicy({ unexpected: true } as Partial<TonVerificationEvidencePolicy>),
      ),
    ).toThrow("evidence policy shape");

    const evidence = commit();
    const fixture = approvalFixture(evidence);
    expect(() =>
      tonEvidenceApprovalSigningPayload(
        { ...evidence, unexpected: true } as TonVerificationEvidence,
        evidencePolicy(),
        fixture.policy,
      ),
    ).toThrow("verification evidence shape");
    expect(() =>
      approveTonVerificationEvidence(
        evidence,
        evidencePolicy(),
        fixture.policy,
        [
          {
            ...fixture.signatures[0],
            unexpected: true,
          } as TonEvidenceSignature,
          fixture.signatures[1],
        ],
      ),
    ).toThrow("approval signature shape");
  });
});
