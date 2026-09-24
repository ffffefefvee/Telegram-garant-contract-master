import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createPublicKey, JsonWebKey } from "crypto";

export type PrivilegedIdentityKind = "ADMIN" | "ARBITRATOR";

export interface VerifiedPrivilegedIdentity {
  sub: string;
  jti: string;
  sid: string;
  kid: string;
  scope: string[];
  acr: string;
  authTime: number;
  expiresAt: number;
}

interface StepUpClaims {
  sub?: string;
  purpose?: string;
  amr?: string[];
  jti?: string;
  sid?: string;
  scope?: string | string[];
  acr?: string;
  auth_time?: number;
  iat?: number;
  exp?: number;
}

interface JwksDocument {
  keys?: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
}

interface IntrospectionResponse {
  active?: boolean;
  sub?: string;
  jti?: string;
  sid?: string;
  scope?: string | string[];
  token_type?: string;
}

interface CachedJwks {
  fetchedAt: number;
  keys: Map<string, string>;
}

@Injectable()
export class PrivilegedIdentityService {
  private readonly jwksCache = new Map<PrivilegedIdentityKind, CachedJwks>();

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async verify(input: {
    kind: PrivilegedIdentityKind;
    assertion: string;
    actorId: string;
  }): Promise<VerifiedPrivilegedIdentity> {
    const header = this.decodeHeader(input.assertion);
    if (header.alg !== "RS256" || !header.kid?.trim()) {
      throw new UnauthorizedException(
        "Privileged assertion must use RS256 and an explicit key id",
      );
    }

    const publicKey = await this.getVerificationKey(input.kind, header.kid);
    const prefix = input.kind;
    const issuer = this.required(`${prefix}_STEP_UP_ISSUER`);
    const audience = this.required(`${prefix}_STEP_UP_AUDIENCE`);
    const maxAge = this.integer(`${prefix}_STEP_UP_MAX_AGE_SECONDS`, 60, 900);

    let claims: StepUpClaims;
    try {
      claims = this.jwt.verify<StepUpClaims>(input.assertion, {
        publicKey,
        issuer,
        audience,
        maxAge,
        clockTolerance: 10,
        algorithms: ["RS256"],
      });
    } catch {
      throw new UnauthorizedException("Privileged MFA assertion is invalid or stale");
    }

    const expectedPurpose =
      input.kind === "ADMIN" ? "admin_step_up" : "arbitrator_step_up";
    const requiredScope = this.required(`${prefix}_STEP_UP_REQUIRED_SCOPE`);
    const requiredAcr = this.required(`${prefix}_STEP_UP_REQUIRED_ACR`);
    const scopes = normalizeScopes(claims.scope);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      claims.sub !== input.actorId ||
      claims.purpose !== expectedPurpose ||
      !Array.isArray(claims.amr) ||
      !claims.amr.includes("mfa") ||
      !claims.jti?.trim() ||
      !claims.sid?.trim() ||
      claims.acr !== requiredAcr ||
      !scopes.includes(requiredScope) ||
      !Number.isSafeInteger(claims.auth_time) ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.auth_time! > claims.iat! + 10 ||
      nowSeconds - claims.auth_time! > maxAge
    ) {
      throw new UnauthorizedException(
        "Privileged MFA assertion lacks required actor, session, scope or authentication context",
      );
    }

    await this.assertActive(input.kind, input.assertion, {
      sub: claims.sub,
      jti: claims.jti,
      sid: claims.sid,
      requiredScope,
    });

    return {
      sub: claims.sub,
      jti: claims.jti,
      sid: claims.sid,
      kid: header.kid,
      scope: scopes,
      acr: claims.acr,
      authTime: claims.auth_time!,
      expiresAt: claims.exp!,
    };
  }

  private decodeHeader(assertion: string): { alg?: string; kid?: string } {
    const decoded = this.jwt.decode(assertion, { complete: true }) as
      | { header?: { alg?: string; kid?: string } }
      | null;
    if (!decoded?.header) {
      throw new UnauthorizedException("Privileged assertion is malformed");
    }
    return decoded.header;
  }

  private async getVerificationKey(
    kind: PrivilegedIdentityKind,
    kid: string,
  ): Promise<string> {
    const cacheSeconds = this.integer(
      `${kind}_STEP_UP_JWKS_CACHE_SECONDS`,
      30,
      3600,
    );
    let cached = this.jwksCache.get(kind);
    if (!cached || Date.now() - cached.fetchedAt >= cacheSeconds * 1000) {
      cached = await this.fetchJwks(kind);
    }
    let key = cached.keys.get(kid);
    if (!key) {
      cached = await this.fetchJwks(kind);
      key = cached.keys.get(kid);
    }
    if (!key) {
      throw new UnauthorizedException("Privileged assertion key id is unknown");
    }
    return key;
  }

  private async fetchJwks(kind: PrivilegedIdentityKind): Promise<CachedJwks> {
    const response = await this.fetchWithTimeout(
      this.required(`${kind}_STEP_UP_JWKS_URL`),
      { method: "GET", headers: { accept: "application/json" } },
      kind,
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Privileged identity JWKS returned HTTP ${response.status}`,
      );
    }
    let document: JwksDocument;
    try {
      document = (await response.json()) as JwksDocument;
    } catch {
      throw new ServiceUnavailableException("Privileged identity JWKS is malformed");
    }
    const keys = new Map<string, string>();
    for (const jwk of document.keys ?? []) {
      if (
        !jwk.kid?.trim() ||
        jwk.kty !== "RSA" ||
        (jwk.alg && jwk.alg !== "RS256") ||
        (jwk.use && jwk.use !== "sig")
      ) {
        continue;
      }
      try {
        keys.set(
          jwk.kid,
          createPublicKey({ key: jwk, format: "jwk" })
            .export({ type: "spki", format: "pem" })
            .toString(),
        );
      } catch {
        continue;
      }
    }
    if (keys.size === 0) {
      throw new ServiceUnavailableException(
        "Privileged identity JWKS contains no usable RS256 keys",
      );
    }
    const cached = { fetchedAt: Date.now(), keys };
    this.jwksCache.set(kind, cached);
    return cached;
  }

  private async assertActive(
    kind: PrivilegedIdentityKind,
    assertion: string,
    expected: { sub: string; jti: string; sid: string; requiredScope: string },
  ): Promise<void> {
    const body = new URLSearchParams({ token: assertion, token_type_hint: "access_token" });
    const response = await this.fetchWithTimeout(
      this.required(`${kind}_STEP_UP_INTROSPECTION_URL`),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.required(`${kind}_STEP_UP_INTROSPECTION_TOKEN`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
      kind,
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Privileged identity introspection returned HTTP ${response.status}`,
      );
    }
    let result: IntrospectionResponse;
    try {
      result = (await response.json()) as IntrospectionResponse;
    } catch {
      throw new ServiceUnavailableException(
        "Privileged identity introspection response is malformed",
      );
    }
    if (
      result.active !== true ||
      result.sub !== expected.sub ||
      result.jti !== expected.jti ||
      result.sid !== expected.sid ||
      !normalizeScopes(result.scope).includes(expected.requiredScope)
    ) {
      throw new UnauthorizedException(
        "Privileged identity session is inactive, revoked or mismatched",
      );
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    kind: PrivilegedIdentityKind,
  ): Promise<Response> {
    const timeoutMs = this.integer(`${kind}_STEP_UP_IDP_TIMEOUT_MS`, 500, 15000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new ServiceUnavailableException(
        "Privileged identity provider is unavailable; access fails closed",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private required(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }
    return value;
  }

  private integer(key: string, minimum: number, maximum: number): number {
    const value = Number(this.config.get(key));
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new ServiceUnavailableException(
        `${key} must be an integer between ${minimum} and ${maximum}`,
      );
    }
    return value;
  }
}

function normalizeScopes(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((scope) => typeof scope === "string");
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}
