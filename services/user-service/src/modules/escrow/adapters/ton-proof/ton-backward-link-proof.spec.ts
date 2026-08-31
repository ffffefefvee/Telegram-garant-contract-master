import { readFileSync } from "fs";
import { resolve } from "path";
import {
  TonBackwardLinkProofError,
  verifyTonBackwardBlockLink,
} from "./ton-backward-link-proof";
import {
  decodeTonLitePartialBlockProof,
  type TonLiteBlockLinkBack,
} from "./ton-lite-signature-proof";

const FIXTURE = resolve(process.cwd(), "fixtures/ton-proof/testnet");
const LITE_LIMITS = {
  maxBytes: 16 * 1024 * 1024,
  maxLinks: 64,
  maxSignaturesPerLink: 4096,
  maxEmbeddedProofBytes: 16 * 1024 * 1024,
};
const BOC_LIMITS = {
  maxBocBytes: 16 * 1024 * 1024,
  maxCells: 1_000_000,
  maxDepth: 1024,
};

function capturedBackwardLink(): TonLiteBlockLinkBack {
  const raw = readFileSync(resolve(FIXTURE, "checkpoint-proof.tl"));
  const proof = decodeTonLitePartialBlockProof(raw.toString("base64"), LITE_LIMITS);
  const link = proof.steps[proof.steps.length - 1];
  if (link.kind !== "back") throw new Error("testnet fixture has no final backward link");
  return link;
}

function flipMiddleByte(value: Buffer): Buffer {
  const mutated = Buffer.from(value);
  mutated[Math.floor(mutated.length / 2)] ^= 1;
  return mutated;
}

describe("TON authenticated backward block link", () => {
  it("proves the captured historical testnet target from the authenticated newer key block", () => {
    const link = capturedBackwardLink();
    const result = verifyTonBackwardBlockLink(link, {
      globalId: -3,
      authenticatedSourceBlock: link.from,
      limits: BOC_LIMITS,
    });

    expect(result).toMatchObject({
      authenticatedSourceVerified: true,
      sourceStateProofVerified: true,
      previousBlockDictionaryInclusionVerified: true,
      destinationProofVerified: true,
      destinationBlock: link.to,
      finalityProven: false,
    });
  });

  it("rejects a source that was not authenticated by the preceding forward link", () => {
    const link = capturedBackwardLink();
    expect(() =>
      verifyTonBackwardBlockLink(link, {
        globalId: -3,
        authenticatedSourceBlock: { ...link.from, fileHash: "0".repeat(64) },
        limits: BOC_LIMITS,
      }),
    ).toThrow("source is not the authenticated block");
  });

  it.each(["proof", "stateProof", "destProof"] as const)(
    "rejects a one-bit mutation in %s",
    (field) => {
      const link = capturedBackwardLink();
      const mutated = { ...link, [field]: flipMiddleByte(link[field]) };
      expect(() =>
        verifyTonBackwardBlockLink(mutated, {
          globalId: -3,
          authenticatedSourceBlock: link.from,
          limits: BOC_LIMITS,
        }),
      ).toThrow();
    },
  );

  it("rejects substitution of the historical destination BlockIdExt", () => {
    const link = capturedBackwardLink();
    expect(() =>
      verifyTonBackwardBlockLink(
        { ...link, to: { ...link.to, rootHash: "0".repeat(64) } },
        {
          globalId: -3,
          authenticatedSourceBlock: link.from,
          limits: BOC_LIMITS,
        },
      ),
    ).toThrow(TonBackwardLinkProofError);
  });
});
