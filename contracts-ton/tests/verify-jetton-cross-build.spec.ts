import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginCell } from "@ton/core";
import { verifyJettonCrossBuild } from "../scripts/verify-jetton-cross-build";

describe("Jetton cross-build verification evidence", () => {
  async function fixture(actonHash?: string) {
    const directory = await mkdtemp(join(tmpdir(), "jetton-cross-build-"));
    const code = beginCell().storeUint(0x0f8a7ea5, 32).endCell();
    const boc = code.toBoc();
    const codeHash = code.hash().toString("hex");
    const blueprintPath = join(directory, "blueprint.json");
    const actonPath = join(directory, "acton.json");
    const outputPath = join(directory, "verification.json");
    await writeFile(
      blueprintPath,
      JSON.stringify({
        contract: "TonJettonEscrow",
        compilerVersion: "1.4.1",
        codeHash,
        bocSha256: createHash("sha256").update(boc).digest("hex"),
        bocHex: boc.toString("hex"),
      }),
    );
    await writeFile(
      actonPath,
      JSON.stringify({
        code_boc64: boc.toString("base64"),
        hash: actonHash ?? codeHash.toUpperCase(),
      }),
    );
    await mkdir(join(directory, "contracts"));
    await writeFile(join(directory, "Acton.toml"), "manifest");
    await writeFile(join(directory, "package-lock.json"), "lock");
    await writeFile(join(directory, "contracts", "TonJettonEscrow.tolk"), "contract");
    await writeFile(join(directory, "contracts", "jetton-types.tolk"), "types");
    return { directory, blueprintPath, actonPath, outputPath, codeHash };
  }

  it("emits non-authorizing evidence only when independent BOCs agree", async () => {
    const paths = await fixture();
    const manifest = await verifyJettonCrossBuild({
      ...paths,
      projectRoot: paths.directory,
      sourceRevision: "abc123",
      actonVersion: "1.1.0",
    });
    expect(manifest).toMatchObject({
      status: "verification_only",
      authorizationAllowed: false,
      contract: "TonJettonEscrow",
      codeHash: paths.codeHash,
      sourceRevision: "abc123",
    });
    expect(JSON.parse(await readFile(paths.outputPath, "utf8"))).toEqual(manifest);
  });

  it("fails closed when the authoritative declared hash differs", async () => {
    const paths = await fixture("00".repeat(32));
    await expect(
      verifyJettonCrossBuild({ ...paths, projectRoot: paths.directory }),
    ).rejects.toThrow("Acton declared code hash does not match its BOC");
  });

  it("fails closed when both artifacts are self-consistent but their code differs", async () => {
    const paths = await fixture();
    const differentCode = beginCell().storeUint(0x0f8a7ea6, 32).endCell();
    await writeFile(
      paths.actonPath,
      JSON.stringify({
        code_boc64: differentCode.toBoc().toString("base64"),
        hash: differentCode.hash().toString("hex"),
      }),
    );
    await expect(
      verifyJettonCrossBuild({ ...paths, projectRoot: paths.directory }),
    ).rejects.toThrow("Cross-build code hash mismatch");
  });
});
