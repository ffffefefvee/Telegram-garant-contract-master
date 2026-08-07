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

  if (failures.length > 0) {
    throw new Error(
      `Unsafe production configuration:\n- ${failures.join("\n- ")}`,
    );
  }

  return environment;
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
