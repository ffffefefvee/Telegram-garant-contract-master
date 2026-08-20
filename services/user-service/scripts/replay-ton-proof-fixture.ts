import { readFile } from "fs/promises";
import { resolve } from "path";
import { TON_PROOF_FIXTURE_ARTIFACT_NAMES } from "../src/modules/escrow/adapters/ton-proof/ton-proof-fixture-manifest";
import { replayTonProofFixtureOffline } from "../src/modules/escrow/adapters/ton-proof/ton-proof-fixture-replay";

function fixtureDirectory(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== "--fixture" || !argv[1]) {
    throw new Error("usage: npm run fixture:ton:replay -- --fixture <directory>");
  }
  return resolve(argv[1]);
}

async function replay(directory: string): Promise<void> {
  const rawManifest = await readFile(resolve(directory, "manifest.json"));
  const artifacts = Object.fromEntries(
    await Promise.all(
      TON_PROOF_FIXTURE_ARTIFACT_NAMES.map(async (name) => [
        name,
        await readFile(resolve(directory, name)),
      ]),
    ),
  );
  const result = await replayTonProofFixtureOffline(rawManifest, artifacts);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void replay(fixtureDirectory(process.argv.slice(2))).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
