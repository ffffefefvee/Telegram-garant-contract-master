import { createHash } from "crypto";
import {
  TON_PROOF_FIXTURE_ARTIFACT_NAMES,
  verifyTonProofFixtureManifest,
  type TonProofFixtureArtifactName,
} from "./ton-proof-fixture-manifest";
import { replayTonProofFixtureOffline } from "./ton-proof-fixture-replay";

export interface TonProofFixtureCorruptionCase {
  artifact: TonProofFixtureArtifactName;
  byteOffset: number;
  bitMask: 1;
  rejected: true;
  rejectionClass: string;
  rejectionMessageHash: string;
}

export interface TonProofFixtureCorruptionMatrix {
  kind: "TON_PROOF_FIXTURE_CORRUPTION_MATRIX";
  baselineReplayVerified: true;
  manifestRehashedForEachMutation: true;
  everyMutationRejected: true;
  authorizationAllowed: false;
  network: "mainnet" | "testnet";
  targetMasterchainSeqno: number;
  baselineReplayEvidenceHash: string;
  caseCount: number;
  cases: readonly TonProofFixtureCorruptionCase[];
  matrixEvidenceHash: string;
}

export class TonProofFixtureCorruptionMatrixError extends Error {
  readonly name = "TonProofFixtureCorruptionMatrixError";
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mutationOffset(
  name: TonProofFixtureArtifactName,
  value: Buffer,
  zeroStateRootHash: string,
): number {
  if (name === "official-global-config.json") {
    const rootBase64 = Buffer.from(zeroStateRootHash, "hex").toString("base64");
    const offset = value.indexOf(Buffer.from(rootBase64));
    if (offset < 0) {
      throw new TonProofFixtureCorruptionMatrixError(
        "official config does not contain the pinned zerostate root",
      );
    }
    return offset;
  }
  if (value.length === 0) {
    throw new TonProofFixtureCorruptionMatrixError(`${name} is empty`);
  }
  return Math.floor(value.length / 2);
}

function rejectionClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function rejectionMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runTonProofFixtureCorruptionMatrix(
  rawManifest: Buffer,
  suppliedArtifacts: Readonly<Record<string, Buffer>>,
): Promise<TonProofFixtureCorruptionMatrix> {
  const verified = verifyTonProofFixtureManifest(
    rawManifest,
    suppliedArtifacts,
  );
  const baseline = await replayTonProofFixtureOffline(
    rawManifest,
    suppliedArtifacts,
  );
  const cases: TonProofFixtureCorruptionCase[] = [];
  for (const name of TON_PROOF_FIXTURE_ARTIFACT_NAMES) {
    const artifacts = Object.fromEntries(
      TON_PROOF_FIXTURE_ARTIFACT_NAMES.map((artifactName) => [
        artifactName,
        Buffer.from(verified.artifacts[artifactName]),
      ]),
    ) as Record<TonProofFixtureArtifactName, Buffer>;
    const offset = mutationOffset(
      name,
      artifacts[name],
      verified.manifest.zeroState.rootHash,
    );
    artifacts[name][offset] ^= 1;
    const manifest = JSON.parse(
      JSON.stringify(verified.manifest),
    ) as typeof verified.manifest;
    manifest.artifacts[name] = {
      bytes: artifacts[name].length,
      sha256: sha256(artifacts[name]),
    };
    const mutatedManifest = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    let failure: unknown;
    try {
      verifyTonProofFixtureManifest(mutatedManifest, artifacts);
      await replayTonProofFixtureOffline(mutatedManifest, artifacts);
    } catch (error) {
      failure = error;
    }
    if (failure === undefined) {
      throw new TonProofFixtureCorruptionMatrixError(
        `${name} one-bit corruption was accepted`,
      );
    }
    cases.push({
      artifact: name,
      byteOffset: offset,
      bitMask: 1,
      rejected: true,
      rejectionClass: rejectionClass(failure),
      rejectionMessageHash: sha256(rejectionMessage(failure)),
    });
  }
  const evidence = {
    domain: "telegram-garant/ton-proof-fixture-corruption-matrix/v1",
    network: verified.manifest.network,
    targetMasterchainBlock: verified.manifest.targetMasterchainBlock,
    manifestHash: verified.manifestHash,
    artifactSetHash: verified.artifactSetHash,
    baselineReplayEvidenceHash: baseline.replayEvidenceHash,
    cases,
  };
  return {
    kind: "TON_PROOF_FIXTURE_CORRUPTION_MATRIX",
    baselineReplayVerified: true,
    manifestRehashedForEachMutation: true,
    everyMutationRejected: true,
    authorizationAllowed: false,
    network: verified.manifest.network,
    targetMasterchainSeqno: verified.manifest.targetMasterchainBlock.seqno,
    baselineReplayEvidenceHash: baseline.replayEvidenceHash,
    caseCount: cases.length,
    cases,
    matrixEvidenceHash: sha256(JSON.stringify(evidence)),
  };
}
