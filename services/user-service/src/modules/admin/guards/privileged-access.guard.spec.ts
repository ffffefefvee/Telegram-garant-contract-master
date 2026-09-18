import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { generateKeyPairSync } from "crypto";
import type { ExecutionContext } from "@nestjs/common";
import { PrivilegedAccessGuard } from "./privileged-access.guard";

const KEY_PAIR = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY = KEY_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIVATE_KEY = KEY_PAIR.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ISSUER = "https://identity.example.test";

function config(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    ADMIN_ALLOWED_ORIGINS: "https://admin.example.test",
    ADMIN_STEP_UP_JWT_PUBLIC_KEY_BASE64: Buffer.from(PUBLIC_KEY).toString("base64"),
    ADMIN_STEP_UP_ISSUER: ISSUER,
    ADMIN_STEP_UP_AUDIENCE: "telegram-garant-admin",
    ADMIN_STEP_UP_MAX_AGE_SECONDS: "300",
    ADMIN_EMERGENCY_LOCKOUT: "false",
    ...overrides,
  };
  return { get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback) } as any;
}

function context(input: {
  path?: string;
  origin?: string;
  assertion?: string;
  actorId?: string;
}): ExecutionContext {
  const headers: Record<string, string | undefined> = {
    origin: input.origin,
    "x-admin-step-up": input.assertion,
  };
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => ({
        path: input.path ?? "/admin/ops",
        originalUrl: input.path ?? "/admin/ops",
        user: input.actorId ? { id: input.actorId } : undefined,
        header: (name: string) => headers[name.toLowerCase()],
      }),
    }),
  } as unknown as ExecutionContext;
}

function assertion(jwt: JwtService, actorId = "admin-1", amr = ["pwd", "mfa"]): string {
  return jwt.sign(
    { sub: actorId, purpose: "admin_step_up", amr, jti: "assertion-1" },
    {
      privateKey: PRIVATE_KEY,
      algorithm: "RS256",
      issuer: ISSUER,
      audience: "telegram-garant-admin",
      expiresIn: 300,
    },
  );
}

describe("PrivilegedAccessGuard", () => {
  const jwt = new JwtService();

  it("does not affect non-admin routes", () => {
    const guard = new PrivilegedAccessGuard(config({ ADMIN_ALLOWED_ORIGINS: "" }), jwt);
    expect(guard.canActivate(context({ path: "/deals" }))).toBe(true);
  });

  it("requires an explicitly allowed administrative origin", () => {
    const guard = new PrivilegedAccessGuard(config(), jwt);
    expect(() =>
      guard.canActivate(
        context({
          actorId: "admin-1",
          origin: "https://phishing.example.test",
          assertion: assertion(jwt),
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("fails closed when privileged identity verification is not configured", () => {
    const guard = new PrivilegedAccessGuard(
      config({ ADMIN_STEP_UP_JWT_PUBLIC_KEY_BASE64: "" }),
      jwt,
    );
    expect(() =>
      guard.canActivate(
        context({ actorId: "admin-1", origin: "https://admin.example.test", assertion: "x" }),
      ),
    ).toThrow(ServiceUnavailableException);
  });

  it("rejects an assertion for another actor or without MFA", () => {
    const guard = new PrivilegedAccessGuard(config(), jwt);
    const allowed = { actorId: "admin-1", origin: "https://admin.example.test" };
    expect(() =>
      guard.canActivate(context({ ...allowed, assertion: assertion(jwt, "admin-2") })),
    ).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(context({ ...allowed, assertion: assertion(jwt, "admin-1", ["pwd"]) })),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a symmetrically signed token even when its claims are valid", () => {
    const guard = new PrivilegedAccessGuard(config(), jwt);
    const forged = jwt.sign(
      {
        sub: "admin-1",
        purpose: "admin_step_up",
        amr: ["mfa"],
        jti: "forged",
      },
      {
        secret: "attacker-controlled-secret-with-enough-length",
        issuer: ISSUER,
        audience: "telegram-garant-admin",
        expiresIn: 300,
        algorithm: "HS256",
      },
    );
    expect(() =>
      guard.canActivate(
        context({
          actorId: "admin-1",
          origin: "https://admin.example.test",
          assertion: forged,
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("accepts a fresh independently signed MFA assertion bound to the actor", () => {
    const guard = new PrivilegedAccessGuard(config(), jwt);
    expect(
      guard.canActivate(
        context({
          actorId: "admin-1",
          origin: "https://admin.example.test",
          assertion: assertion(jwt),
        }),
      ),
    ).toBe(true);
  });

  it("blocks all administrative access during emergency lockout", () => {
    const guard = new PrivilegedAccessGuard(
      config({ ADMIN_EMERGENCY_LOCKOUT: "true" }),
      jwt,
    );
    expect(() =>
      guard.canActivate(
        context({
          actorId: "admin-1",
          origin: "https://admin.example.test",
          assertion: assertion(jwt),
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
