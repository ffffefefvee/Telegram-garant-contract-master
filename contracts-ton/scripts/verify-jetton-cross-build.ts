import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Cell } from "@ton/core";

interface BlueprintArtifact {
  contract: string;
  compilerVersion: string;
  codeHash: string;
  bocSha256: string;
  bocHex: string;
}

interface ActonArtifact {
  code_boc64: string;
  hash: string;
}

const SOURCE_FILES = [
  "Acton.toml",
  "package-lock.json",
  "contracts/TonJettonEscrow.tolk",
  "contracts/jetton-types.tolk",
] as const;

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeHash(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} hash is missing`);
  const normalized = value.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} hash must contain exactly 32 bytes`);
  }
  return normalized;
}

function parseSingleRoot(boc: Buffer, label: string): Cell {
  let roots: Cell[];
  try {
    roots = Cell.fromBoc(boc);
  } catch {
    throw new Error(`${label} is not a valid BOC`);
  }
  if (roots.length !== 1) throw new Error(`${label} must contain one root cell`);
  return roots[0];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function verifyJettonCrossBuild(input: {
  blueprintPath: string;
  actonPath: string;
  outputPath: string;
  projectRoot?: string;
  sourceRevision?: string;
  actonVersion?: string;
}) {
  const projectRoot = input.projectRoot ?? process.cwd();
  const blueprint = await readJson<BlueprintArtifact>(input.blueprintPath);
  const acton = await readJson<ActonArtifact>(input.actonPath);
  if (blueprint.contract !== "TonJettonEscrow") {
    throw new Error("Unexpected Blueprint contract name");
  }
  if (blueprint.compilerVersion !== "1.4.1") {
    throw new Error("Unexpected Blueprint Tolk compiler version");
  }

  const blueprintBoc = Buffer.from(blueprint.bocHex, "hex");
  if (!blueprint.bocHex || blueprintBoc.toString("hex") !== blueprint.bocHex.toLowerCase()) {
    throw new Error("Blueprint artifact contains invalid BOC hex");
  }
  const blueprintRoot = parseSingleRoot(blueprintBoc, "Blueprint artifact");
  const blueprintHash = blueprintRoot.hash().toString("hex");
  if (blueprintHash !== normalizeHash(blueprint.codeHash, "Blueprint")) {
    throw new Error("Blueprint declared code hash does not match its BOC");
  }
  if (sha256(blueprintBoc) !== normalizeHash(blueprint.bocSha256, "Blueprint BOC SHA-256")) {
    throw new Error("Blueprint declared BOC SHA-256 does not match its BOC");
  }

  const actonBoc = Buffer.from(acton.code_boc64, "base64");
  if (!acton.code_boc64 || actonBoc.length === 0) {
    throw new Error("Acton artifact contains no code BOC");
  }
  const actonRoot = parseSingleRoot(actonBoc, "Acton artifact");
  const actonHash = actonRoot.hash().toString("hex");
  if (actonHash !== normalizeHash(acton.hash, "Acton")) {
    throw new Error("Acton declared code hash does not match its BOC");
  }
  if (actonHash !== blueprintHash) {
    throw new Error(
      `Cross-build code hash mismatch: Blueprint=${blueprintHash}, Acton=${actonHash}`,
    );
  }

  const sources: Record<string, string> = {};
  for (const relativePath of SOURCE_FILES) {
    sources[relativePath] = sha256(await readFile(resolve(projectRoot, relativePath)));
  }
  const manifest = {
    schemaVersion: 1,
    status: "verification_only",
    authorizationAllowed: false,
    contract: "TonJettonEscrow",
    sourceRevision: input.sourceRevision ?? null,
    codeHash: blueprintHash,
    toolchains: {
      blueprintTolk: blueprint.compilerVersion,
      acton: input.actonVersion ?? "1.1.0",
    },
    artifacts: {
      blueprint: { bocSha256: sha256(blueprintBoc) },
      acton: { bocSha256: sha256(actonBoc) },
    },
    sources,
  };
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function main() {
  const outputPath = resolve(
    process.argv[4] ?? "build/TonJettonEscrow.cross-build-verification.json",
  );
  const manifest = await verifyJettonCrossBuild({
    blueprintPath: resolve(
      process.argv[2] ?? "build/cross/blueprint/TonJettonEscrow.compiled.json",
    ),
    actonPath: resolve(process.argv[3] ?? "build/cross/acton/TonJettonEscrow.json"),
    outputPath,
    sourceRevision: process.env.GITHUB_SHA,
    actonVersion: process.env.ACTON_VERSION,
  });
  process.stdout.write(`Verified independent Jetton code hash ${manifest.codeHash}\n`);
  process.stdout.write(`Wrote non-authorizing verification evidence ${outputPath}\n`);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
