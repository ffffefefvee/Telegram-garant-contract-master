import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  releaseApprovalPayload,
  verifyReleaseApproval,
} from "../scripts/verify-release-approval";

describe("TON release approval policy", () => {
  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "ton-release-approval-"));
    const candidatePath = join(directory, "candidate.json");
    const policyPath = join(directory, "policy.json");
    const signaturesPath = join(directory, "signatures.json");
    const outputPath = join(directory, "approval.json");
    const candidate = {
      schemaVersion: 1,
      status: "unsigned_release_candidate",
      contract: "TonNativeEscrow",
      sourceRevision: "abc123",
      codeHash: "11".repeat(32),
      approvals: { required: 2, signatures: [] },
    };
    const candidateBytes = Buffer.from(
      `${JSON.stringify(candidate, null, 2)}\n`,
    );
    await writeFile(candidatePath, candidateBytes);
    const candidateSha256 = createHash("sha256")
      .update(candidateBytes)
      .digest("hex");
    const keys = [
      "release-officer-a",
      "release-officer-b",
      "release-officer-c",
    ].map((id) => ({ id, ...generateKeyPairSync("ed25519") }));
    const policy = {
      schemaVersion: 1,
      policyId: "ton-mainnet-v1",
      threshold: 2,
      signers: keys.map(({ id, publicKey }) => ({
        id,
        algorithm: "ed25519",
        enabled: true,
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
      })),
    };
    await writeFile(policyPath, JSON.stringify(policy));
    const payload = releaseApprovalPayload(policy.policyId, candidateSha256);
    const signatures = {
      schemaVersion: 1,
      policyId: policy.policyId,
      candidateSha256,
      signatures: keys.slice(0, 2).map(({ id, privateKey }) => ({
        signerId: id,
        algorithm: "ed25519",
        signatureBase64: signPayload(null, payload, privateKey).toString(
          "base64",
        ),
      })),
    };
    await writeFile(signaturesPath, JSON.stringify(signatures));
    return {
      candidatePath,
      policyPath,
      signaturesPath,
      outputPath,
      candidate,
      policy,
      signatures,
      keys,
    };
  }

  it("requires two distinct authorized signatures over the exact candidate", async () => {
    const files = await fixture();
    const approval = await verifyReleaseApproval(files);
    expect(approval).toMatchObject({
      status: "approved_release_evidence",
      threshold: 2,
      verifiedSigners: ["release-officer-a", "release-officer-b"],
    });
    expect(JSON.parse(await readFile(files.outputPath, "utf8"))).toEqual(
      approval,
    );
  });

  it("rejects a duplicate signer even when both signatures are valid", async () => {
    const files = await fixture();
    files.signatures.signatures[1] = files.signatures.signatures[0];
    await writeFile(files.signaturesPath, JSON.stringify(files.signatures));
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "Duplicate signature",
    );
  });

  it("rejects signatures after any candidate-byte change", async () => {
    const files = await fixture();
    const candidate = await readFile(files.candidatePath);
    await writeFile(
      files.candidatePath,
      Buffer.concat([candidate, Buffer.from(" ")]),
    );
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "Signature bundle does not match policy and candidate",
    );
  });

  it("rejects a bundle below the configured threshold", async () => {
    const files = await fixture();
    files.signatures.signatures.pop();
    await writeFile(files.signaturesPath, JSON.stringify(files.signatures));
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "requires 2 signatures; verified 1",
    );
  });

  it.each([
    [
      "candidate",
      "candidatePath",
      "[]",
      "Release candidate must be a JSON object",
    ],
    ["policy", "policyPath", "null", "Release policy must be a JSON object"],
    [
      "signature bundle",
      "signaturesPath",
      "{",
      "Signature bundle is not valid JSON",
    ],
  ])(
    "rejects malformed %s JSON structures",
    async (_label, pathKey, contents, expectedMessage) => {
      const files = await fixture();
      await writeFile(
        files[pathKey as "candidatePath" | "policyPath" | "signaturesPath"],
        contents,
      );
      await expect(verifyReleaseApproval(files)).rejects.toThrow(
        expectedMessage,
      );
    },
  );

  it("rejects malformed and ambiguous policy signer records", async () => {
    const files = await fixture();
    files.policy.signers[0] = null as never;
    await writeFile(files.policyPath, JSON.stringify(files.policy));
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "Release policy signer must be a JSON object",
    );

    const extraFieldFiles = await fixture();
    Object.assign(extraFieldFiles.policy.signers[0], { role: "approver" });
    await writeFile(
      extraFieldFiles.policyPath,
      JSON.stringify(extraFieldFiles.policy),
    );
    await expect(verifyReleaseApproval(extraFieldFiles)).rejects.toThrow(
      "Release policy signer contains unexpected field role",
    );
  });

  it("rejects unauthorized and disabled signers", async () => {
    const unauthorized = await fixture();
    unauthorized.signatures.signatures[1].signerId = "release-officer-x";
    await writeFile(
      unauthorized.signaturesPath,
      JSON.stringify(unauthorized.signatures),
    );
    await expect(verifyReleaseApproval(unauthorized)).rejects.toThrow(
      "Signature from unauthorized signer release-officer-x",
    );

    const disabled = await fixture();
    disabled.policy.signers[1].enabled = false;
    await writeFile(disabled.policyPath, JSON.stringify(disabled.policy));
    await expect(verifyReleaseApproval(disabled)).rejects.toThrow(
      "Signature from unauthorized signer release-officer-b",
    );
  });

  it("rejects non-Ed25519 policy entries and signature declarations", async () => {
    const policyFiles = await fixture();
    policyFiles.policy.signers[0].algorithm = "rsa";
    await writeFile(policyFiles.policyPath, JSON.stringify(policyFiles.policy));
    await expect(verifyReleaseApproval(policyFiles)).rejects.toThrow(
      "Release policy contains an invalid signer",
    );

    const signatureFiles = await fixture();
    signatureFiles.signatures.signatures[0].algorithm = "rsa";
    await writeFile(
      signatureFiles.signaturesPath,
      JSON.stringify(signatureFiles.signatures),
    );
    await expect(verifyReleaseApproval(signatureFiles)).rejects.toThrow(
      "Signature from unauthorized signer release-officer-a",
    );
  });

  it("rejects private-key material in a public release policy", async () => {
    const files = await fixture();
    files.policy.signers[0].publicKeyPem = files.keys[0].privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    await writeFile(files.policyPath, JSON.stringify(files.policy));
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "must contain only a public key",
    );
  });

  it("rejects a candidate and policy threshold mismatch", async () => {
    const files = await fixture();
    files.candidate.approvals.required = 3;
    await writeFile(
      files.candidatePath,
      `${JSON.stringify(files.candidate, null, 2)}\n`,
    );
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "Release candidate and policy thresholds differ",
    );
  });

  it("rejects policy identity mismatches", async () => {
    const files = await fixture();
    files.signatures.policyId = "ton-mainnet-v2";
    await writeFile(files.signaturesPath, JSON.stringify(files.signatures));
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "Signature bundle does not match policy and candidate",
    );
  });

  it.each([
    ["malformed base64", "not-base64"],
    ["cryptographically invalid bytes", Buffer.alloc(64).toString("base64")],
  ])("rejects %s signatures", async (_label, signatureBase64) => {
    const files = await fixture();
    files.signatures.signatures[0].signatureBase64 = signatureBase64;
    await writeFile(files.signaturesPath, JSON.stringify(files.signatures));
    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "Invalid signature from release-officer-a",
    );
  });

  it("does not overwrite approval evidence when verification fails", async () => {
    const files = await fixture();
    const sentinel = "previous-evidence-must-remain-intact\n";
    await writeFile(files.outputPath, sentinel);
    files.signatures.signatures[0].signatureBase64 = "not-base64";
    await writeFile(files.signaturesPath, JSON.stringify(files.signatures));

    await expect(verifyReleaseApproval(files)).rejects.toThrow(
      "Invalid signature",
    );
    expect(await readFile(files.outputPath, "utf8")).toBe(sentinel);
  });
});
