/**
 * Fail fast on configurations that are acceptable for a local sandbox but
 * unsafe for a production process. This runs inside ConfigModule before the
 * rest of AppModule is constructed, so the service does not begin serving
 * traffic with development credentials or controls enabled.
 */
export function validateEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (environment.NODE_ENV !== "production") {
    return environment;
  }

  const failures: string[] = [];
  const requiredSecrets = [
    "DB_PASSWORD",
    "REDIS_PASSWORD",
    "JWT_SECRET",
    "TELEGRAM_BOT_TOKEN",
  ];

  for (const key of requiredSecrets) {
    if (isUnsafeSecret(environment[key])) {
      failures.push(`${key} must be a non-placeholder production secret`);
    }
  }

  if (environment.AUTH_DEV_MODE === "true") {
    failures.push("AUTH_DEV_MODE must be false in production");
  }
  if (environment.DB_USE_SQLITE === "true") {
    failures.push("DB_USE_SQLITE must be false in production");
  }
  if (environment.DB_SYNCHRONIZE === "true") {
    failures.push("DB_SYNCHRONIZE must be false in production; use migrations");
  }
  if (!hasOnlyHttpsOrigins(environment.CORS_ORIGIN)) {
    failures.push(
      "CORS_ORIGIN must contain one or more explicit https:// origins in production",
    );
  }
  if (environment.TELEGRAM_TEST_INJECT_ENABLED === "true") {
    failures.push("TELEGRAM_TEST_INJECT_ENABLED must be false in production");
  }
  if (environment.TON_CONNECT_ENABLED === "true") {
    if (!isTonProofDomain(environment.TON_CONNECT_PROOF_DOMAIN)) {
      failures.push(
        "TON_CONNECT_PROOF_DOMAIN must be an explicit host without scheme or path",
      );
    }
    if (!["-239", "-3"].includes(environment.TON_CONNECT_NETWORK ?? "")) {
      failures.push(
        "TON_CONNECT_NETWORK must be -239 (mainnet) or -3 (testnet)",
      );
    }
  }
  if (environment.TON_NATIVE_INGESTION_ENABLED === "true") {
    if (environment.DB_MIGRATIONS_RUN !== "true") {
      failures.push(
        "DB_MIGRATIONS_RUN must be true before native TON ingestion can be enabled",
      );
    }
    if (isUnsafeSecret(environment.TONCENTER_API_KEY)) {
      failures.push(
        "TONCENTER_API_KEY must be a non-placeholder production secret when native TON ingestion is enabled",
      );
    }
    const tonCenterUrl = environment.TONCENTER_V3_BASE_URL?.trim();
    if (tonCenterUrl && !isHttpsBaseUrl(tonCenterUrl)) {
      failures.push(
        "TONCENTER_V3_BASE_URL must be an explicit HTTPS URL in production",
      );
    }
    if (environment.TON_NATIVE_RECONCILIATION_REQUIRED !== "true") {
      failures.push(
        "TON_NATIVE_RECONCILIATION_REQUIRED must be true before native TON ingestion can be enabled in production",
      );
    }
    if (!isIndependentTonV2Url(environment.TON_LITESERVER_V2_BASE_URL)) {
      failures.push(
        "TON_LITESERVER_V2_BASE_URL must be an explicit independent HTTPS API v2 URL in production",
      );
    }
    if (
      !/^[a-zA-Z0-9._-]{3,64}$/.test(
        environment.TON_LITESERVER_V2_SOURCE?.trim() ?? "",
      )
    ) {
      failures.push(
        "TON_LITESERVER_V2_SOURCE must identify the independent operator",
      );
    }
    if (isUnsafeSecret(environment.TON_LITESERVER_V2_API_KEY)) {
      failures.push(
        "TON_LITESERVER_V2_API_KEY must be a non-placeholder production secret when native TON ingestion is enabled",
      );
    }
  }
  if (
    environment.MONEY_EGRESS_ENABLED === "true" &&
    environment.DB_MIGRATIONS_RUN !== "true"
  ) {
    failures.push(
      "DB_MIGRATIONS_RUN must be true before money egress can be enabled",
    );
  }
  if (
    environment.MONEY_EGRESS_ENABLED === "true" &&
    environment.RECONCILIATION_ENABLED !== "true"
  ) {
    failures.push(
      "RECONCILIATION_ENABLED must be true before money egress can be enabled",
    );
  }
  if (
    environment.TON_NATIVE_MANUAL_REVIEW_CHECK_INTERVAL_MS !== undefined &&
    !isIntegerInRange(
      environment.TON_NATIVE_MANUAL_REVIEW_CHECK_INTERVAL_MS,
      60_000,
      3_600_000,
    )
  ) {
    failures.push(
      "TON_NATIVE_MANUAL_REVIEW_CHECK_INTERVAL_MS must be 60000-3600000",
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `Unsafe production configuration:\n- ${failures.join("\n- ")}`,
    );
  }

  return environment;
}

function isTonProofDomain(value: string | undefined): boolean {
  if (!value) return false;
  const domain = value.trim();
  return (
    domain.length > 0 &&
    Buffer.byteLength(domain, "utf8") <= 128 &&
    !/:\/\/|[\s/?#]/.test(domain)
  );
}

function isUnsafeSecret(value: string | undefined): boolean {
  if (!value || value.trim().length < 1) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("replace_me") ||
    normalized.includes("dev-only") ||
    normalized === "changeme" ||
    normalized === "change_me" ||
    normalized === "password" ||
    normalized === "0:dev-only-invalid-token"
  );
}

function hasOnlyHttpsOrigins(value: string | undefined): boolean {
  if (!value || value.trim() === "" || value.trim() === "*") {
    return false;
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .every((origin) => /^https:\/\/[^/\s]+(?:\/.*)?$/i.test(origin));
}

function isHttpsBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isIndependentTonV2Url(value: string | undefined): boolean {
  if (!value || !isHttpsBaseUrl(value.trim())) return false;
  const hostname = new URL(value.trim()).hostname;
  return !/(^|\.)toncenter\.com$/i.test(hostname);
}

function isIntegerInRange(value: string, minimum: number, maximum: number) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum;
}
