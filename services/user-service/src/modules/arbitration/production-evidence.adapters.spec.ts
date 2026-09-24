import { BadGatewayException } from "@nestjs/common";
import { generateKeyPairSync, sign } from "crypto";
import {
  AuthenticatedEvidenceMalwareScanner,
  canonicalScanResult,
} from "./production-evidence.adapters";

describe("AuthenticatedEvidenceMalwareScanner", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const values: Record<string, string> = {
    EVIDENCE_SCANNER_URL: "https://scanner.example.test/v1/scan",
    EVIDENCE_SCANNER_API_TOKEN: "secret-token",
    EVIDENCE_SCANNER_PUBLIC_KEY_BASE64: Buffer.from(
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    ).toString("base64"),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  };
  const scanner = new AuthenticatedEvidenceMalwareScanner(config as any);

  afterEach(() => jest.restoreAllMocks());

  function response(overrides: Record<string, unknown> = {}) {
    const body = {
      requestId: "filled-from-request",
      resultId: "result-1",
      clean: true,
      sha256: "filled-from-request",
      scannerName: "scanner-a",
      scannerVersion: "1.2.3",
      policyVersion: "policy-7",
      scannedAt: new Date().toISOString(),
      evidence: "engine=clamav;database=20260920",
      signature: "",
      ...overrides,
    };
    return body;
  }

  function mockSignedResponse(overrides: Record<string, unknown> = {}) {
    jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const body = response({
        requestId: request.requestId,
        sha256: request.sha256,
        ...overrides,
      });
      body.signature = sign(
        null,
        Buffer.from(canonicalScanResult(body as any), "utf8"),
        privateKey,
      ).toString("base64");
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  it("accepts a fresh signed result bound to the exact bytes", async () => {
    mockSignedResponse();
    await expect(
      scanner.scan({ bytes: Buffer.from("safe"), mediaType: "text/plain" }),
    ).resolves.toMatchObject({
      clean: true,
      policyVersion: "policy-7",
      resultId: "result-1",
    });
  });

  it("rejects a validly signed callback for different bytes", async () => {
    mockSignedResponse({ sha256: "0".repeat(64) });
    await expect(
      scanner.scan({ bytes: Buffer.from("safe"), mediaType: "text/plain" }),
    ).rejects.toThrow(BadGatewayException);
  });

  it("rejects an altered signature", async () => {
    jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const body = response({
        requestId: request.requestId,
        sha256: request.sha256,
        signature: Buffer.alloc(64).toString("base64"),
      });
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await expect(
      scanner.scan({ bytes: Buffer.from("safe"), mediaType: "text/plain" }),
    ).rejects.toThrow("signature is invalid");
  });
});
