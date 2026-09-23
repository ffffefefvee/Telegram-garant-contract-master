import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { PrivilegedIdentityService } from "../auth/privileged-identity.service";

const SENSITIVE_ARBITRATOR_PATHS = [
  /^\/?(?:api\/)?arbitration\/evidence\/[^/]+\/verify$/,
  /^\/?(?:api\/)?arbitration\/disputes\/[^/]+\/decision$/,
  /^\/?(?:api\/)?arbitration\/decisions\/[^/]+\/enforce$/,
  /^\/?(?:api\/)?arbitration\/decisions\/[^/]+\/ton-native\/resolve-request$/,
  /^\/?(?:api\/)?arbitration\/disputes\/[^/]+\/record-resolution$/,
  /^\/?(?:api\/)?arbitration\/appeals\/[^/]+\/review$/,
  /^\/?(?:api\/)?arbitration\/arbitrators\/me(?:\/|$)/,
];

@Injectable()
export class ArbitratorAccessGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly identity: PrivilegedIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (!isSensitiveArbitratorRequest(request)) return true;

    if (
      this.config.get<string>("ARBITRATOR_EMERGENCY_LOCKOUT", "false") ===
      "true"
    ) {
      throw new ForbiddenException("Arbitrator access is emergency-locked");
    }

    const origins = new Set(
      this.config
        .get<string>("ARBITRATOR_ALLOWED_ORIGINS", "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
    const origin = request.header("origin")?.trim();
    if (origins.size === 0) {
      throw new ServiceUnavailableException(
        "Arbitrator origin allowlist is not configured",
      );
    }
    if (!origin || !origins.has(origin)) {
      throw new ForbiddenException("Arbitrator request origin is not allowed");
    }

    const actorId = request.user?.id;
    if (!actorId) {
      throw new UnauthorizedException("Authenticated arbitrator is required");
    }
    const assertion = request.header("x-arbitrator-step-up")?.trim();
    if (!assertion) {
      throw new UnauthorizedException("Fresh arbitrator MFA assertion is required");
    }

    const verified = await this.identity.verify({
      kind: "ARBITRATOR",
      assertion,
      actorId,
    });
    (request as Request & { privilegedIdentity?: unknown }).privilegedIdentity = verified;
    return true;
  }
}

function isSensitiveArbitratorRequest(request: Request): boolean {
  const path = (request.path || request.originalUrl || "").split("?")[0];
  return SENSITIVE_ARBITRATOR_PATHS.some((pattern) => pattern.test(path));
}
