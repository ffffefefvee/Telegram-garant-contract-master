import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { ArbitratorAccessGuard } from "./arbitrator-access.guard";

function config(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    ARBITRATOR_ALLOWED_ORIGINS: "https://arbitrator.example.test",
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

describe("ArbitratorAccessGuard", () => {
  const identity = {
    verify: jest.fn().mockResolvedValue({ sub: "arbitrator-1", jti: "jti-1" }),
  };

  beforeEach(() => jest.clearAllMocks());

  it("does not affect ordinary dispute-party routes", async () => {
    const guard = new ArbitratorAccessGuard(config(), identity as any);
    await expect(
      guard.canActivate(context({ path: "/arbitration/disputes/one" })),
    ).resolves.toBe(true);
  });

  it("requires the dedicated arbitrator origin", async () => {
    const guard = new ArbitratorAccessGuard(config(), identity as any);
    await expect(
      guard.canActivate(
        context({
          path: "/arbitration/disputes/one/decision",
          origin: "https://admin.example.test",
          actorId: "arbitrator-1",
          assertion: "assertion",
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("requires a bound assertion and delegates full IdP verification", async () => {
    const guard = new ArbitratorAccessGuard(config(), identity as any);
    const base = {
      path: "/arbitration/evidence/one/verify",
      origin: "https://arbitrator.example.test",
      actorId: "arbitrator-1",
    };
    await expect(guard.canActivate(context(base))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(context({ ...base, assertion: "signed-assertion" })),
    ).resolves.toBe(true);
    expect(identity.verify).toHaveBeenCalledWith({
      kind: "ARBITRATOR",
      actorId: "arbitrator-1",
      assertion: "signed-assertion",
    });
  });

  it("supports emergency lockout", async () => {
    const guard = new ArbitratorAccessGuard(
      config({ ARBITRATOR_EMERGENCY_LOCKOUT: "true" }),
      identity as any,
    );
    await expect(
      guard.canActivate(
        context({
          path: "/arbitration/arbitrators/me",
          origin: "https://arbitrator.example.test",
          actorId: "arbitrator-1",
          assertion: "assertion",
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("requires arbitrator step-up before recording an on-chain resolution", async () => {
    const guard = new ArbitratorAccessGuard(config(), identity as any);
    await expect(
      guard.canActivate(
        context({
          path: "/arbitration/disputes/dispute-1/record-resolution",
          origin: "https://arbitrator.example.test",
          actorId: "arbitrator-1",
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
