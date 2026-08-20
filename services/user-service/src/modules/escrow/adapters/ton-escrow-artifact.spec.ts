import { createHash } from "node:crypto";
import { beginCell } from "@ton/ton";
import { verifyTonEscrowArtifact } from "./ton-escrow-artifact";

function fixture() {
  const code = beginCell().storeUint(0x12345678, 32).endCell();
  const boc = code.toBoc();
  const artifact = {
    contract: "TonNativeEscrow",
    sourceLanguage: "tolk",
    compilerVersion: "1.4.0",
    codeHash: code.hash().toString("hex"),
    bocSha256: createHash("sha256").update(boc).digest("hex"),
    bocHex: boc.toString("hex"),
    minOperationalReserveNano: "200000000",
  };
  const raw = Buffer.from(`${JSON.stringify(artifact)}\n`, "utf8");
  return {
    raw,
    codeHash: artifact.codeHash,
    fileHash: createHash("sha256").update(raw).digest("hex"),
  };
}

describe("TON escrow artifact verification", () => {
  it("accepts only an exact allowlisted release file with an intact BOC", () => {
    const artifact = fixture();
    expect(
      verifyTonEscrowArtifact(
        artifact.raw,
        artifact.fileHash,
        artifact.codeHash,
      ),
    ).toMatchObject({
      verified: true,
      reason: "verified",
      codeHash: artifact.codeHash,
      compilerVersion: "1.4.0",
      minOperationalReserveNano: "200000000",
    });
  });

  it("fails closed when the release file digest is not allowlisted", () => {
    const artifact = fixture();
    expect(
      verifyTonEscrowArtifact(artifact.raw, "2".repeat(64), artifact.codeHash),
    ).toEqual({ verified: false, reason: "artifact_file_hash_mismatch" });
  });

  it("fails closed when the approved code-cell hash differs", () => {
    const artifact = fixture();
    expect(
      verifyTonEscrowArtifact(artifact.raw, artifact.fileHash, "3".repeat(64)),
    ).toEqual({ verified: false, reason: "artifact_code_hash_mismatch" });
  });

  it("fails closed when declared code hash is not the parsed BOC root hash", () => {
    const artifact = fixture();
    const parsed = JSON.parse(artifact.raw.toString("utf8"));
    parsed.codeHash = "4".repeat(64);
    const raw = Buffer.from(`${JSON.stringify(parsed)}\n`, "utf8");

    expect(
      verifyTonEscrowArtifact(
        raw,
        createHash("sha256").update(raw).digest("hex"),
        parsed.codeHash,
      ),
    ).toEqual({
      verified: false,
      reason: "artifact_code_cell_hash_mismatch",
    });
  });

  it("fails closed when build metadata disagrees with the contract reserve", () => {
    const artifact = fixture();
    const parsed = JSON.parse(artifact.raw.toString("utf8"));
    parsed.minOperationalReserveNano = "199999999";
    const raw = Buffer.from(`${JSON.stringify(parsed)}\n`, "utf8");

    expect(
      verifyTonEscrowArtifact(
        raw,
        createHash("sha256").update(raw).digest("hex"),
        artifact.codeHash,
      ),
    ).toEqual({
      verified: false,
      reason: "artifact_operational_reserve_mismatch",
    });
  });
});
