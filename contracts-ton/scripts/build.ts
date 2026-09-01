import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compile } from '@ton/blueprint';
import { getTolkCompilerVersion } from '@ton/tolk-js';

async function main() {
  const compilerVersion = await getTolkCompilerVersion();
  if (compilerVersion !== '1.4.1') {
    throw new Error(`Unexpected Tolk compiler version: ${compilerVersion}`);
  }
  const buildDirectory = resolve(process.cwd(), 'build');
  await mkdir(buildDirectory, { recursive: true });

  for (const contract of ['TonNativeEscrow', 'TonJettonEscrow'] as const) {
    const code = await compile(contract);
    const boc = code.toBoc();
    const artifact = {
      contract,
      sourceLanguage: 'tolk',
      compilerVersion,
      codeHash: code.hash().toString('hex'),
      codeHashBase64: code.hash().toString('base64'),
      bocSha256: createHash('sha256').update(boc).digest('hex'),
      bocHex: boc.toString('hex'),
      ...(contract === 'TonNativeEscrow'
        ? { minOperationalReserveNano: '200000000' }
        : {}),
    };
    const artifactPath = resolve(buildDirectory, `${contract}.compiled.json`);
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    process.stdout.write(`Compiled ${contract} ${artifact.codeHash}\n`);
    process.stdout.write(`Wrote ${artifactPath}\n`);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
