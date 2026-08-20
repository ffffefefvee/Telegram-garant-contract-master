import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizeDeployment } from "../scripts/authorize-deployment";
import { releaseApprovalPayload } from "../scripts/verify-release-approval";

describe("TON deployment authorization lock", () => {
  const digest = (byte: string) => byte.repeat(64);

  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "ton-deployment-lock-"));
    const candidatePath = join(directory, "candidate.json");
    const approvalPath = join(directory, "approval.json");
    const policyPath = join(directory, "policy.json");
    const signaturesPath = join(directory, "signatures.json");
    const deploymentRecordPath = join(directory, "deployment-record.json");
    const outputPath = join(directory, "deployment-input.json");
    const candidate = {
      schemaVersion: 1,
      status: "unsigned_release_candidate",
      contract: "TonNativeEscrow",
      sourceRevision: "abc123",
      codeHash: digest("1"),
      minOperationalReserveNano: "30000000",
      toolchains: {
        blueprintTolk: "1.4.1",
        acton: "1.1.0",
      },
      artifacts: {
        blueprint: { bocSha256: digest("2") },
        acton: { bocSha256: digest("3") },
      },
      sources: {
        "Acton.toml": digest("4"),
        "package-lock.json": digest("5"),
        "contracts/TonNativeEscrow.tolk": digest("6"),
        "contracts/types.tolk": digest("7"),
      },
      approvals: {
        required: 2,
        signatures: [],
      },
    };
    const candidateBytes = Buffer.from(
      `${JSON.stringify(candidate, null, 2)}\n`,
      "utf8",
    );
    const candidateSha256 = createHash("sha256")
      .update(candidateBytes)
      .digest("hex");
    const approval = {
      schemaVersion: 1,
      status: "approved_release_evidence",
      policyId: "ton-mainnet-v1",
      candidateSha256,
      sourceRevision: candidate.sourceRevision,
      codeHash: candidate.codeHash,
      threshold: 2,
      verifiedSigners: ["release-officer-a", "release-officer-b"],
    };
    const keys = approval.verifiedSigners.map((id) => ({
      id,
      ...generateKeyPairSync("ed25519"),
    }));
    const policy = {
      schemaVersion: 1,
      policyId: approval.policyId,
      threshold: approval.threshold,
      signers: keys.map(({ id, publicKey }) => ({
        id,
        algorithm: "ed25519",
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
        enabled: true,
      })),
    };
    const payload = releaseApprovalPayload(approval.policyId, candidateSha256);
    const signatures = {
      schemaVersion: 1,
      policyId: approval.policyId,
      candidateSha256,
      signatures: keys.map(({ id, privateKey }) => ({
        signerId: id,
        algorithm: "ed25519",
        signatureBase64: signPayload(null, payload, privateKey).toString(
          "base64",
        ),
      })),
    };
    const deploymentRecord = {
      schemaVersion: 1,
      status: "deployment_authorization_request",
      contract: "TonNativeEscrow",
      targetNetwork: "mainnet",
      expectedCandidateSha256: candidateSha256,
      expectedSourceRevision: candidate.sourceRevision,
      expectedCodeHash: candidate.codeHash,
      expectedPolicyId: approval.policyId,
      expectedApprovalThreshold: approval.threshold,
      expectedVerifiedSigners: [...approval.verifiedSigners],
    };
    await writeFile(candidatePath, candidateBytes);
    await writeFile(approvalPath, JSON.stringify(approval));
    await writeFile(policyPath, JSON.stringify(policy));
    await writeFile(signaturesPath, JSON.stringify(signatures));
    await writeFile(deploymentRecordPath, JSON.stringify(deploymentRecord));
    return {
      candidatePath,
      approvalPath,
      policyPath,
      signaturesPath,
      deploymentRecordPath,
      outputPath,
      candidate,
      candidateBytes,
      candidateSha256,
      approval,
      policy,
      signatures,
      deploymentRecord,
    };
  }

  it("emits only a fully bound, validated deployment input", async () => {
    const files = await fixture();
    const authorization = await authorizeDeployment(files);

    expect(authorization).toEqual({
      schemaVersion: 1,
      status: "validated_deployment_input",
      contract: "TonNativeEscrow",
      targetNetwork: "mainnet",
      candidateSha256: files.candidateSha256,
      deploymentRecordSha256: createHash("sha256")
        .update(await readFile(files.deploymentRecordPath))
        .digest("hex"),
      sourceRevision: "abc123",
      codeHash: digest("1"),
      policyId: "ton-mainnet-v1",
      approvalThreshold: 2,
      verifiedSigners: ["release-officer-a", "release-officer-b"],
    });
    expect(JSON.parse(await readFile(files.outputPath, "utf8"))).toEqual(
      authorization,
    );
  });

  it("binds approval to the exact candidate bytes", async () => {
    const files = await fixture();
    await writeFile(
      files.candidatePath,
      Buffer.concat([files.candidateBytes, Buffer.from(" ")]),
    );

    await expect(authorizeDeployment(files)).rejects.toThrow(
      "Approval candidate digest does not match",
    );
  });

  it("rejects fabricated evidence even when the operator record repeats it", async () => {
    const files = await fixture();
    files.approval.verifiedSigners = ["release-officer-a", "release-officer-c"];
    files.deploymentRecord.expectedVerifiedSigners = [
      ...files.approval.verifiedSigners,
    ];
    await writeFile(files.approvalPath, JSON.stringify(files.approval));
    await writeFile(
      files.deploymentRecordPath,
      JSON.stringify(files.deploymentRecord),
    );

    await expect(authorizeDeployment(files)).rejects.toThrow(
      "Provided approval evidence does not match cryptographic verification",
    );
  });

  it("rejects invalid signatures despite plausible approval evidence", async () => {
    const files = await fixture();
    files.signatures.signatures[0].signatureBase64 =
      Buffer.alloc(64).toString("base64");
    await writeFile(files.signaturesPath, JSON.stringify(files.signatures));

    await expect(authorizeDeployment(files)).rejects.toThrow(
      "Invalid signature from release-officer-a",
    );
  });

  it.each([
    ["candidate digest", "expectedCandidateSha256", digest("8")],
    ["source revision", "expectedSourceRevision", "different-revision"],
    ["code hash", "expectedCodeHash", digest("9")],
    ["approval policy", "expectedPolicyId", "ton-mainnet-v2"],
    ["approval threshold", "expectedApprovalThreshold", 3],
  ])(
    "rejects an operator record with a mismatched expected %s",
    async (_label, field, value) => {
      const files = await fixture();
      Object.assign(files.deploymentRecord, { [field]: value });
      await writeFile(
        files.deploymentRecordPath,
        JSON.stringify(files.deploymentRecord),
      );

      await expect(authorizeDeployment(files)).rejects.toThrow(
        /does not match/,
      );
    },
  );

  it.each([
    ["sourceRevision", "different-revision", "Approval source revision"],
    ["codeHash", digest("a"), "Approval code hash"],
  ])(
    "rejects approval evidence with mismatched %s",
    async (field, value, message) => {
      const files = await fixture();
      Object.assign(files.approval, { [field]: value });
      await writeFile(files.approvalPath, JSON.stringify(files.approval));

      await expect(authorizeDeployment(files)).rejects.toThrow(message);
    },
  );

  it("rejects an approval threshold that differs from the candidate", async () => {
    const files = await fixture();
    files.approval.threshold = 3;
    files.approval.verifiedSigners.push("release-officer-c");
    await writeFile(files.approvalPath, JSON.stringify(files.approval));

    await expect(authorizeDeployment(files)).rejects.toThrow(
      "Approval threshold does not match",
    );
  });

  it("rejects duplicate, insufficient, unsorted, and unexpected signers", async () => {
    const duplicate = await fixture();
    duplicate.approval.verifiedSigners = [
      "release-officer-a",
      "release-officer-a",
    ];
    await writeFile(duplicate.approvalPath, JSON.stringify(duplicate.approval));
    await expect(authorizeDeployment(duplicate)).rejects.toThrow(
      "must contain distinct signers",
    );

    const insufficient = await fixture();
    insufficient.approval.verifiedSigners = ["release-officer-a"];
    await writeFile(
      insufficient.approvalPath,
      JSON.stringify(insufficient.approval),
    );
    await expect(authorizeDeployment(insufficient)).rejects.toThrow(
      "fewer signers than its threshold",
    );

    const unsorted = await fixture();
    unsorted.approval.verifiedSigners.reverse();
    await writeFile(unsorted.approvalPath, JSON.stringify(unsorted.approval));
    await expect(authorizeDeployment(unsorted)).rejects.toThrow(
      "must be sorted",
    );

    const unexpected = await fixture();
    unexpected.deploymentRecord.expectedVerifiedSigners = [
      "release-officer-a",
      "release-officer-c",
    ];
    await writeFile(
      unexpected.deploymentRecordPath,
      JSON.stringify(unexpected.deploymentRecord),
    );
    await expect(authorizeDeployment(unexpected)).rejects.toThrow(
      "Expected verified signer binding does not match",
    );
  });

  it("rejects a policy that is not bound to the requested TON network", async () => {
    const files = await fixture();
    files.deploymentRecord.targetNetwork = "testnet";
    await writeFile(
      files.deploymentRecordPath,
      JSON.stringify(files.deploymentRecord),
    );

    await expect(authorizeDeployment(files)).rejects.toThrow(
      "Approval policy is not bound to the target network",
    );
  });

  it.each([
    ["candidate", "candidatePath", "privateKey"],
    ["approval evidence", "approvalPath", "signatureBase64"],
    ["deployment record", "deploymentRecordPath", "broadcastEndpoint"],
  ])(
    "fails closed on extra fields in %s",
    async (_label, pathField, extraField) => {
      const files = await fixture();
      const path =
        files[
          pathField as "candidatePath" | "approvalPath" | "deploymentRecordPath"
        ];
      const parsed = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
      parsed[extraField] = "must-not-be-accepted";
      await writeFile(path, JSON.stringify(parsed));

      await expect(authorizeDeployment(files)).rejects.toThrow(
        `unexpected field ${extraField}`,
      );
    },
  );

  it("fails closed on extra nested candidate fields", async () => {
    const files = await fixture();
    Object.assign(files.candidate.artifacts.blueprint, { compiler: "other" });
    await writeFile(files.candidatePath, JSON.stringify(files.candidate));

    await expect(authorizeDeployment(files)).rejects.toThrow(
      "Release candidate blueprint artifact contains unexpected field compiler",
    );
  });

  it.each([
    ["candidatePath", "Release candidate"],
    ["approvalPath", "Approved release evidence"],
    ["deploymentRecordPath", "Deployment authorization record"],
  ])("rejects malformed JSON in %s", async (pathField, label) => {
    const files = await fixture();
    await writeFile(
      files[
        pathField as "candidatePath" | "approvalPath" | "deploymentRecordPath"
      ],
      "{",
    );

    await expect(authorizeDeployment(files)).rejects.toThrow(
      `${label} is not valid JSON`,
    );
  });

  it("preserves an existing output byte-for-byte on every validation failure", async () => {
    const files = await fixture();
    const sentinel = Buffer.from("previous-authorized-input-must-survive\n");
    await writeFile(files.outputPath, sentinel);
    files.deploymentRecord.expectedCodeHash = digest("f");
    await writeFile(
      files.deploymentRecordPath,
      JSON.stringify(files.deploymentRecord),
    );

    await expect(authorizeDeployment(files)).rejects.toThrow(
      "Expected code hash does not match",
    );
    expect(await readFile(files.outputPath)).toEqual(sentinel);
  });
});
