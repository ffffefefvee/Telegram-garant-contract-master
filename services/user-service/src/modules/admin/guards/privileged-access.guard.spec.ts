import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { PrivilegedAccessGuard } from "./privileged-access.guard";
import { Role } from "../enums/role.enum";

function config(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    ADMIN_ALLOWED_ORIGINS: "https://admin.example.test",
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
    getHandler: () => context,
    getClass: () => Object,
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

function reflector(roles?: Role[]) {
  return { getAllAndOverride: jest.fn().mockReturnValue(roles) } as any;
}

describe("PrivilegedAccessGuard", () => {
  const identity = {
    verify: jest.fn().mockResolvedValue({ sub: "admin-1", jti: "jti-1" }),
  };

  beforeEach(() => jest.clearAllMocks());

  it("does not affect non-admin routes", async () => {
    const guard = new PrivilegedAccessGuard(config(), identity as any, reflector());
    await expect(guard.canActivate(context({ path: "/deals" }))).resolves.toBe(true);
    expect(identity.verify).not.toHaveBeenCalled();
  });

  it("requires an explicitly allowed administrative origin", async () => {
    const guard = new PrivilegedAccessGuard(config(), identity as any, reflector());
    await expect(
      guard.canActivate(
        context({
          actorId: "admin-1",
          origin: "https://phishing.example.test",
          assertion: "assertion",
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("requires an authenticated actor and assertion", async () => {
    const guard = new PrivilegedAccessGuard(config(), identity as any, reflector());
    await expect(
      guard.canActivate(context({ origin: "https://admin.example.test" })),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      guard.canActivate(
        context({ actorId: "admin-1", origin: "https://admin.example.test" }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("delegates verification and attaches the verified identity", async () => {
    const guard = new PrivilegedAccessGuard(config(), identity as any, reflector());
    const ctx = context({
      actorId: "admin-1",
      origin: "https://admin.example.test",
      assertion: "signed-assertion",
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(identity.verify).toHaveBeenCalledWith({
      kind: "ADMIN",
      actorId: "admin-1",
      assertion: "signed-assertion",
    });
  });

  it("blocks all administrative access during emergency lockout", async () => {
    const guard = new PrivilegedAccessGuard(
      config({ ADMIN_EMERGENCY_LOCKOUT: "true" }),
      identity as any,
      reflector(),
    );
    await expect(
      guard.canActivate(
        context({
          actorId: "admin-1",
          origin: "https://admin.example.test",
          assertion: "assertion",
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("requires step-up for admin-decorated routes outside /admin", async () => {
    const guard = new PrivilegedAccessGuard(
      config(),
      identity as any,
      reflector([Role.SUPER_ADMIN]),
    );
    await expect(
      guard.canActivate(
        context({
          path: "/users/user-id/roles",
          actorId: "admin-1",
          origin: "https://admin.example.test",
          assertion: "signed-assertion",
        }),
      ),
    ).resolves.toBe(true);
    expect(identity.verify).toHaveBeenCalled();
  });
});
