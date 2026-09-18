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
  if (!hasOnlyHttpsOrigins(environment.ADMIN_ALLOWED_ORIGINS)) {
    failures.push(
      "ADMIN_ALLOWED_ORIGINS must contain one or more explicit https:// origins in production",
    );
  }
  if (!hasOnlyHttpsOrigins(environment.ARBITRATOR_ALLOWED_ORIGINS)) {
    failures.push(
      "ARBITRATOR_ALLOWED_ORIGINS must contain one or more explicit https:// origins in production",
    );
  }
  if (
    originsOverlap(
      environment.ADMIN_ALLOWED_ORIGINS,
      environment.ARBITRATOR_ALLOWED_ORIGINS,
    )
  ) {
    failures.push(
      "ADMIN_ALLOWED_ORIGINS and ARBITRATOR_ALLOWED_ORIGINS must use separate origins",
    );
  }
  if (isUnsafePrivilegedSecret(environment.ADMIN_STEP_UP_JWT_SECRET)) {
    failures.push(
      "ADMIN_STEP_UP_JWT_SECRET must be an independent 32+ character production secret",
    );
  }
  if (isUnsafePrivilegedSecret(environment.ARBITRATOR_STEP_UP_JWT_SECRET)) {
    failures.push(
      "ARBITRATOR_STEP_UP_JWT_SECRET must be an independent 32+ character production secret",
    );
  }
  if (
    environment.ARBITRATOR_STEP_UP_JWT_SECRET ===
    environment.ADMIN_STEP_UP_JWT_SECRET
  ) {
    failures.push("Admin and arbitrator step-up signing secrets must be distinct");
  }
  if (!isHttpsBaseUrl(environment.ADMIN_STEP_UP_ISSUER?.trim() ?? "")) {
    failures.push("ADMIN_STEP_UP_ISSUER must be an explicit HTTPS URL");
  }
  if (!isHttpsBaseUrl(environment.ARBITRATOR_STEP_UP_ISSUER?.trim() ?? "")) {
    failures.push("ARBITRATOR_STEP_UP_ISSUER must be an explicit HTTPS URL");
  }
  if (
    environment.ADMIN_STEP_UP_MAX_AGE_SECONDS !== undefined &&
    !isIntegerInRange(environment.ADMIN_STEP_UP_MAX_AGE_SECONDS, 60, 900)
  ) {
    failures.push("ADMIN_STEP_UP_MAX_AGE_SECONDS must be 60-900");
  }
  if (
    environment.ARBITRATOR_STEP_UP_MAX_AGE_SECONDS !== undefined &&
    !isIntegerInRange(
      environment.ARBITRATOR_STEP_UP_MAX_AGE_SECONDS,
      60,
      900,
    )
  ) {
    failures.push("ARBITRATOR_STEP_UP_MAX_AGE_SECONDS must be 60-900");
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
  if (environment.MONEY_EGRESS_ENABLED === "true") {
    if (!["137", "80002"].includes(environment.BLOCKCHAIN_CHAIN_ID ?? "")) {
      failures.push(
        "BLOCKCHAIN_CHAIN_ID must be Polygon mainnet (137) or Amoy (80002) before money egress can be enabled",
      );
    }
    for (const key of [
      "ESCROW_FACTORY_ADDRESS",
      "PLATFORM_TREASURY_ADDRESS",
      "ARBITRATOR_REGISTRY_ADDRESS",
      "USDT_CONTRACT_ADDRESS",
      "WEB3SIGNER_ADDRESS",
    ]) {
      if (!isNonzeroEvmAddress(environment[key])) {
        failures.push(`${key} must be an explicit nonzero EVM address before money egress can be enabled`);
      }
    }
    if (environment.RELAY_SIGNER !== "web3signer") {
      failures.push(
        "RELAY_SIGNER must be web3signer before production money egress can be enabled",
      );
    }
    if (!isHttpBaseUrl(environment.WEB3SIGNER_RPC_URL)) {
      failures.push(
        "WEB3SIGNER_RPC_URL must be an explicit HTTP(S) endpoint without embedded credentials",
      );
    }
    if (environment.POLYGON_INDEXER_ENABLED !== "true") {
      failures.push(
        "POLYGON_INDEXER_ENABLED must be true before production money egress can be enabled",
      );
    }
    if (environment.POLYGON_RECONCILIATION_REQUIRED !== "true") {
      failures.push(
        "POLYGON_RECONCILIATION_REQUIRED must be true before production money egress can be enabled",
      );
    }
    if (!hasIndependentPolygonRpcSources(environment)) {
      failures.push(
        "BLOCKCHAIN_RPC_URL and BLOCKCHAIN_RPC_URLS must provide at least two independent HTTPS Polygon RPC hosts",
      );
    }
    if (
      !isIntegerInRange(
        environment.POLYGON_FINALITY_CONFIRMATIONS ?? "",
        64,
        10_000,
      )
    ) {
      failures.push(
        "POLYGON_FINALITY_CONFIRMATIONS must be 64-10000 before production money egress can be enabled",
      );
    }
    if (
      !/^[1-9]\d*$/.test(
        environment.POLYGON_RELAYER_MINIMUM_BALANCE_WEI ?? "",
      )
    ) {
      failures.push(
        "POLYGON_RELAYER_MINIMUM_BALANCE_WEI must be a positive integer before production money egress can be enabled",
      );
    }
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

function isUnsafePrivilegedSecret(value: string | undefined): boolean {
  return isUnsafeSecret(value) || (value?.trim().length ?? 0) < 32;
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

function originsOverlap(
  first: string | undefined,
  second: string | undefined,
): boolean {
  if (!first || !second) return false;
  const firstSet = new Set(
    first.split(",").map((origin) => origin.trim().toLowerCase()),
  );
  return second
    .split(",")
    .map((origin) => origin.trim().toLowerCase())
    .some((origin) => firstSet.has(origin));
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

function isHttpBaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function hasIndependentPolygonRpcSources(
  environment: Record<string, string | undefined>,
): boolean {
  const values = [
    environment.BLOCKCHAIN_RPC_URL ?? "",
    ...(environment.BLOCKCHAIN_RPC_URLS ?? "").split(","),
  ];
  const hosts = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || !isHttpsBaseUrl(trimmed)) continue;
    hosts.add(new URL(trimmed).hostname.toLowerCase());
  }
  return hosts.size >= 2;
}

function isNonzeroEvmAddress(value: string | undefined): boolean {
  return Boolean(
    value &&
      /^0x[0-9a-fA-F]{40}$/.test(value) &&
      !/^0x0{40}$/i.test(value),
  );
}
