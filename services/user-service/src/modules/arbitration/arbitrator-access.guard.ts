import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

interface ArbitratorStepUpClaims {
  sub: string;
  purpose: "arbitrator_step_up";
  amr: string[];
  jti: string;
}

const SENSITIVE_ARBITRATOR_PATHS = [
  /^\/?(?:api\/)?arbitration\/evidence\/[^/]+\/verify$/,
  /^\/?(?:api\/)?arbitration\/disputes\/[^/]+\/decision$/,
  /^\/?(?:api\/)?arbitration\/decisions\/[^/]+\/enforce$/,
  /^\/?(?:api\/)?arbitration\/decisions\/[^/]+\/ton-native\/resolve-request$/,
  /^\/?(?:api\/)?arbitration\/appeals\/[^/]+\/review$/,
  /^\/?(?:api\/)?arbitration\/arbitrators\/me(?:\/|$)/,
];

@Injectable()
export class ArbitratorAccessGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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

    const secret = this.config
      .get<string>("ARBITRATOR_STEP_UP_JWT_SECRET", "")
      .trim();
    const issuer = this.config
      .get<string>("ARBITRATOR_STEP_UP_ISSUER", "")
      .trim();
    if (!secret || !issuer) {
      throw new ServiceUnavailableException(
        "Arbitrator identity verification is not configured",
      );
    }
    const audience = this.config.get<string>(
      "ARBITRATOR_STEP_UP_AUDIENCE",
      "telegram-garant-arbitrator",
    );
    const maxAge = readMaxAge(this.config);

    let claims: ArbitratorStepUpClaims;
    try {
      claims = this.jwt.verify<ArbitratorStepUpClaims>(assertion, {
        secret,
        issuer,
        audience,
        maxAge,
        clockTolerance: 10,
      });
    } catch {
      throw new UnauthorizedException("Arbitrator MFA assertion is invalid or stale");
    }
    if (
      claims.sub !== actorId ||
      claims.purpose !== "arbitrator_step_up" ||
      !Array.isArray(claims.amr) ||
      !claims.amr.includes("mfa") ||
      !claims.jti?.trim()
    ) {
      throw new UnauthorizedException("Arbitrator MFA assertion is not bound to this actor");
    }
    return true;
  }
}

function isSensitiveArbitratorRequest(request: Request): boolean {
  const path = (request.path || request.originalUrl || "").split("?")[0];
  return SENSITIVE_ARBITRATOR_PATHS.some((pattern) => pattern.test(path));
}

function readMaxAge(config: ConfigService): number {
  const parsed = Number(
    config.get<string>("ARBITRATOR_STEP_UP_MAX_AGE_SECONDS", "300"),
  );
  if (!Number.isSafeInteger(parsed) || parsed < 60 || parsed > 900) {
    throw new ServiceUnavailableException(
      "ARBITRATOR_STEP_UP_MAX_AGE_SECONDS must be between 60 and 900",
    );
  }
  return parsed;
}
