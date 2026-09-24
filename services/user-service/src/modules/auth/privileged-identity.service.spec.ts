import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { generateKeyPairSync } from "crypto";
import { PrivilegedIdentityService } from "./privileged-identity.service";

describe("PrivilegedIdentityService", () => {
  const first = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = new JwtService();
  const values: Record<string, string> = {
    ADMIN_STEP_UP_ISSUER: "https://identity.example.test",
    ADMIN_STEP_UP_AUDIENCE: "telegram-garant-admin",
    ADMIN_STEP_UP_MAX_AGE_SECONDS: "300",
    ADMIN_STEP_UP_REQUIRED_SCOPE: "garant:admin:step-up",
    ADMIN_STEP_UP_REQUIRED_ACR: "urn:garant:acr:phishing-resistant",
    ADMIN_STEP_UP_JWKS_URL: "https://identity.example.test/.well-known/jwks.json",
    ADMIN_STEP_UP_JWKS_CACHE_SECONDS: "300",
    ADMIN_STEP_UP_INTROSPECTION_URL: "https://identity.example.test/introspect",
    ADMIN_STEP_UP_INTROSPECTION_TOKEN: "introspection-secret",
    ADMIN_STEP_UP_IDP_TIMEOUT_MS: "2000",
  };
  const config = { get: jest.fn((key: string) => values[key]) };
  let service: PrivilegedIdentityService;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new PrivilegedIdentityService(config as any, jwt);
  });

  function jwk(publicKey: typeof first.publicKey, kid: string) {
    return {
      ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid,
      alg: "RS256",
      use: "sig",
    };
  }

  function assertion(input: {
    kid?: string;
    privateKey?: typeof first.privateKey;
    scope?: string;
    acr?: string;
  } = {}) {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        sub: "admin-1",
        purpose: "admin_step_up",
        amr: ["pwd", "mfa", "hwk"],
        jti: "jti-1",
        sid: "idp-session-1",
        scope: input.scope ?? "garant:admin:step-up",
        acr: input.acr ?? "urn:garant:acr:phishing-resistant",
        auth_time: now,
      },
      {
        privateKey: input.privateKey ?? first.privateKey,
        algorithm: "RS256",
        keyid: input.kid ?? "key-1",
        issuer: values.ADMIN_STEP_UP_ISSUER,
        audience: values.ADMIN_STEP_UP_AUDIENCE,
        expiresIn: 300,
      },
    );
  }

  function mockIdp(options: {
    keys?: unknown[];
    active?: boolean;
    introspectionStatus?: number;
  } = {}) {
    jest.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("jwks")) {
        return new Response(
          JSON.stringify({ keys: options.keys ?? [jwk(first.publicKey, "key-1")] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          active: options.active ?? true,
          sub: "admin-1",
          jti: "jti-1",
          sid: "idp-session-1",
          scope: "garant:admin:step-up",
        }),
        { status: options.introspectionStatus ?? 200 },
      );
    });
  }

  it("accepts a scoped phishing-resistant assertion after online revocation check", async () => {
    mockIdp();
    await expect(
      service.verify({ kind: "ADMIN", actorId: "admin-1", assertion: assertion() }),
    ).resolves.toMatchObject({
      sub: "admin-1",
      jti: "jti-1",
      sid: "idp-session-1",
      kid: "key-1",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("supports key rotation by selecting the asserted kid", async () => {
    mockIdp({
      keys: [jwk(first.publicKey, "key-1"), jwk(second.publicKey, "key-2")],
    });
    await expect(
      service.verify({
        kind: "ADMIN",
        actorId: "admin-1",
        assertion: assertion({ kid: "key-2", privateKey: second.privateKey }),
      }),
    ).resolves.toMatchObject({ kid: "key-2" });
  });

  it("rejects unknown keys, missing scope and weak authentication context", async () => {
    mockIdp();
    await expect(
      service.verify({
        kind: "ADMIN",
        actorId: "admin-1",
        assertion: assertion({ kid: "unknown" }),
      }),
    ).rejects.toThrow(UnauthorizedException);
    service = new PrivilegedIdentityService(config as any, jwt);
    await expect(
      service.verify({
        kind: "ADMIN",
        actorId: "admin-1",
        assertion: assertion({ scope: "openid", acr: "urn:weak" }),
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects a revoked session and fails closed when introspection is unavailable", async () => {
    mockIdp({ active: false });
    await expect(
      service.verify({ kind: "ADMIN", actorId: "admin-1", assertion: assertion() }),
    ).rejects.toThrow(UnauthorizedException);

    service = new PrivilegedIdentityService(config as any, jwt);
    jest.restoreAllMocks();
    mockIdp({ introspectionStatus: 503 });
    await expect(
      service.verify({ kind: "ADMIN", actorId: "admin-1", assertion: assertion() }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("fails closed when JWKS availability cannot establish the signing key", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    await expect(
      service.verify({ kind: "ADMIN", actorId: "admin-1", assertion: assertion() }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
