import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PrivilegedIdentityService } from "../../auth/privileged-identity.service";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { Role } from "../enums/role.enum";

/**
 * Global guard for the `/admin` origin. Normal user JWTs are deliberately not
 * sufficient: every administrative request also needs a fresh, independently
 * signed MFA assertion issued by the configured privileged identity provider.
 */
@Injectable()
export class PrivilegedAccessGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly identity: PrivilegedIdentityService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!isAdminRequest(request) && !this.isPrivilegedRoute(context)) return true;

    if (this.config.get<string>("ADMIN_EMERGENCY_LOCKOUT", "false") === "true") {
      throw new ForbiddenException("Administrative access is emergency-locked");
    }

    this.assertOrigin(request);

    const actorId = request.user?.id;
    if (!actorId) {
      throw new UnauthorizedException("Authenticated administrator is required");
    }

    const assertion = request.header("x-admin-step-up")?.trim();
    if (!assertion) {
      throw new UnauthorizedException("Fresh administrator MFA assertion is required");
    }

    const verified = await this.identity.verify({
      kind: "ADMIN",
      assertion,
      actorId,
    });
    (request as Request & { privilegedIdentity?: unknown }).privilegedIdentity = verified;

    return true;
  }

  private isPrivilegedRoute(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return Boolean(
      roles?.some((role) => role === Role.ADMIN || role === Role.SUPER_ADMIN),
    );
  }

  private assertOrigin(request: Request): void {
    const allowed = parseOrigins(
      this.config.get<string>("ADMIN_ALLOWED_ORIGINS", ""),
    );
    if (allowed.size === 0) {
      throw new ServiceUnavailableException("Administrative origin allowlist is not configured");
    }

    const origin = request.header("origin")?.trim();
    if (!origin || !allowed.has(origin)) {
      throw new ForbiddenException("Administrative request origin is not allowed");
    }
  }
}

function isAdminRequest(request: Request): boolean {
  const path = (request.path || request.originalUrl || "").split("?")[0];
  return /^\/?(?:api\/)?admin(?:\/|$)/.test(path);
}

function parseOrigins(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}
