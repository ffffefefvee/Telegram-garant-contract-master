import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginCell } from "@ton/core";
import { verifyCrossBuild } from "../scripts/verify-cross-build";

describe("TON cross-build release evidence", () => {
  async function fixture(actonHash?: string) {
    const directory = await mkdtemp(join(tmpdir(), "ton-cross-build-"));
    const code = beginCell().storeUint(0x12345678, 32).endCell();
    const boc = code.toBoc();
    const codeHash = code.hash().toString("hex");
    const blueprintPath = join(directory, "blueprint.json");
    const actonPath = join(directory, "acton.json");
    const outputPath = join(directory, "release-candidate.json");
    await writeFile(
      blueprintPath,
      JSON.stringify({
        contract: "TonNativeEscrow",
        compilerVersion: "1.4.1",
        codeHash,
        bocSha256: createHash("sha256").update(boc).digest("hex"),
        bocHex: boc.toString("hex"),
        minOperationalReserveNano: "200000000",
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
    for (const source of ["Acton.toml", "package-lock.json"]) {
      await writeFile(join(directory, source), source);
    }
    await writeFile(
      join(directory, "contracts", "TonNativeEscrow.tolk"),
      "contract source",
    );
    await writeFile(join(directory, "contracts", "types.tolk"), "types source");
    return { directory, blueprintPath, actonPath, outputPath, codeHash };
  }

  it("emits an unsigned two-approval manifest only when both BOCs agree", async () => {
    const paths = await fixture();
    const manifest = await verifyCrossBuild({
      ...paths,
      projectRoot: paths.directory,
      sourceRevision: "abc123",
      actonVersion: "1.1.0",
    });
    expect(manifest).toMatchObject({
      status: "unsigned_release_candidate",
      codeHash: paths.codeHash,
      sourceRevision: "abc123",
      approvals: { required: 2, signatures: [] },
    });
    expect(JSON.parse(await readFile(paths.outputPath, "utf8"))).toEqual(
      manifest,
    );
  });

  it("fails closed when the authoritative declared hash differs", async () => {
    const paths = await fixture("00".repeat(32));
    await expect(
      verifyCrossBuild({
        ...paths,
        projectRoot: paths.directory,
      }),
    ).rejects.toThrow("Acton declared code hash does not match its BOC");
  });
});
