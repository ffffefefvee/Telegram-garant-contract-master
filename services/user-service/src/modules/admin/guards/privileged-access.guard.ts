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

interface AdminStepUpClaims {
  sub: string;
  purpose: "admin_step_up";
  amr: string[];
  jti: string;
  iat: number;
  exp: number;
}

const DEFAULT_AUDIENCE = "telegram-garant-admin";
const DEFAULT_MAX_AGE_SECONDS = 300;

/**
 * Global guard for the `/admin` origin. Normal user JWTs are deliberately not
 * sufficient: every administrative request also needs a fresh, independently
 * signed MFA assertion issued by the configured privileged identity provider.
 */
@Injectable()
export class PrivilegedAccessGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!isAdminRequest(request)) return true;

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

    const publicKey = decodePublicKey(
      this.config.get<string>("ADMIN_STEP_UP_JWT_PUBLIC_KEY_BASE64", ""),
    );
    const issuer = this.config.get<string>("ADMIN_STEP_UP_ISSUER", "").trim();
    if (!publicKey || !issuer) {
      throw new ServiceUnavailableException(
        "Privileged identity verification is not configured",
      );
    }

    const audience = this.config.get<string>(
      "ADMIN_STEP_UP_AUDIENCE",
      DEFAULT_AUDIENCE,
    );
    const maxAgeSeconds = configuredMaxAge(this.config);

    let claims: AdminStepUpClaims;
    try {
      claims = this.jwt.verify<AdminStepUpClaims>(assertion, {
        publicKey,
        issuer,
        audience,
        maxAge: maxAgeSeconds,
        clockTolerance: 10,
        algorithms: ["RS256"],
      });
    } catch {
      throw new UnauthorizedException("Administrator MFA assertion is invalid or stale");
    }

    if (
      claims.sub !== actorId ||
      claims.purpose !== "admin_step_up" ||
      !Array.isArray(claims.amr) ||
      !claims.amr.includes("mfa") ||
      !claims.jti?.trim()
    ) {
      throw new UnauthorizedException("Administrator MFA assertion is not bound to this actor");
    }

    return true;
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

function decodePublicKey(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const decoded = Buffer.from(value.trim(), "base64").toString("utf8");
    return decoded.includes("-----BEGIN PUBLIC KEY-----") ? decoded : null;
  } catch {
    return null;
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

function configuredMaxAge(config: ConfigService): number {
  const raw = config.get<string>(
    "ADMIN_STEP_UP_MAX_AGE_SECONDS",
    String(DEFAULT_MAX_AGE_SECONDS),
  );
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 60 || parsed > 900) {
    throw new ServiceUnavailableException(
      "ADMIN_STEP_UP_MAX_AGE_SECONDS must be between 60 and 900",
    );
  }
  return parsed;
}
