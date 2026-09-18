import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { generateKeyPairSync } from "crypto";
import { ArbitratorAccessGuard } from "./arbitrator-access.guard";

const KEY_PAIR = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY = KEY_PAIR.publicKey.export({ type: "spki", format: "pem" }).toString();
const PRIVATE_KEY = KEY_PAIR.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ISSUER = "https://identity.example.test";

function config(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    ARBITRATOR_ALLOWED_ORIGINS: "https://arbitrator.example.test",
    ARBITRATOR_STEP_UP_JWT_PUBLIC_KEY_BASE64: Buffer.from(PUBLIC_KEY).toString("base64"),
    ARBITRATOR_STEP_UP_ISSUER: ISSUER,
    ARBITRATOR_STEP_UP_AUDIENCE: "telegram-garant-arbitrator",
    ARBITRATOR_STEP_UP_MAX_AGE_SECONDS: "300",
    ARBITRATOR_EMERGENCY_LOCKOUT: "false",
    ...overrides,
  };
  return { get: (key: string, fallback?: string) => values[key] ?? fallback } as any;
}

function context(input: {
  path: string;
  origin?: string;
  actorId?: string;
  assertion?: string;
}) {
  const headers: Record<string, string | undefined> = {
    origin: input.origin,
    "x-arbitrator-step-up": input.assertion,
  };
  return {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => ({
        path: input.path,
        originalUrl: input.path,
        user: input.actorId ? { id: input.actorId } : undefined,
        header: (name: string) => headers[name.toLowerCase()],
      }),
    }),
  } as any;
}

function assertion(jwt: JwtService, actorId = "arbitrator-1") {
  return jwt.sign(
    {
      sub: actorId,
      purpose: "arbitrator_step_up",
      amr: ["pwd", "mfa"],
      jti: "assertion-1",
    },
    {
      privateKey: PRIVATE_KEY,
      algorithm: "RS256",
      issuer: ISSUER,
      audience: "telegram-garant-arbitrator",
      expiresIn: 300,
    },
  );
}

describe("ArbitratorAccessGuard", () => {
  const jwt = new JwtService();

  it("does not affect ordinary dispute-party routes", () => {
    const guard = new ArbitratorAccessGuard(config(), jwt);
    expect(guard.canActivate(context({ path: "/arbitration/disputes/one" }))).toBe(true);
  });

  it("requires the dedicated arbitrator origin", () => {
    const guard = new ArbitratorAccessGuard(config(), jwt);
    expect(() =>
      guard.canActivate(
        context({
          path: "/arbitration/disputes/one/decision",
          origin: "https://admin.example.test",
          actorId: "arbitrator-1",
          assertion: assertion(jwt),
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("requires a fresh MFA assertion bound to the arbitrator", () => {
    const guard = new ArbitratorAccessGuard(config(), jwt);
    const base = {
      path: "/arbitration/evidence/one/verify",
      origin: "https://arbitrator.example.test",
      actorId: "arbitrator-1",
    };
    expect(() => guard.canActivate(context(base))).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(
        context({ ...base, assertion: assertion(jwt, "arbitrator-2") }),
      ),
    ).toThrow(UnauthorizedException);
    expect(
      guard.canActivate(context({ ...base, assertion: assertion(jwt) })),
    ).toBe(true);
  });

  it("supports emergency lockout", () => {
    const guard = new ArbitratorAccessGuard(
      config({ ARBITRATOR_EMERGENCY_LOCKOUT: "true" }),
      jwt,
    );
    expect(() =>
      guard.canActivate(
        context({
          path: "/arbitration/arbitrators/me",
          origin: "https://arbitrator.example.test",
          actorId: "arbitrator-1",
          assertion: assertion(jwt),
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
