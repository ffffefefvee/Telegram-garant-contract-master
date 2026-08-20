import { validateEnvironment } from "./environment.validation";

function productionEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    NODE_ENV: "production",
    DB_PASSWORD: "database-secret",
    REDIS_PASSWORD: "redis-secret",
    JWT_SECRET: "jwt-secret",
    TELEGRAM_BOT_TOKEN: "123456:production-bot-token",
    AUTH_DEV_MODE: "false",
    DB_USE_SQLITE: "false",
    DB_SYNCHRONIZE: "false",
    TELEGRAM_TEST_INJECT_ENABLED: "false",
    CORS_ORIGIN: "https://app.example.com,https://admin.example.com",
    ...overrides,
  };
}

describe("validateEnvironment", () => {
  it("leaves non-production environments available for isolated development and tests", () => {
    expect(validateEnvironment({ NODE_ENV: "test" })).toEqual({
      NODE_ENV: "test",
    });
  });

  it("accepts an explicit safe production configuration", () => {
    const environment = productionEnvironment();

    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    [
      "placeholder DB password",
      { DB_PASSWORD: "replace_me_with_password" },
      "DB_PASSWORD",
    ],
    ["missing JWT secret", { JWT_SECRET: "" }, "JWT_SECRET"],
    ["development authentication", { AUTH_DEV_MODE: "true" }, "AUTH_DEV_MODE"],
    ["SQLite", { DB_USE_SQLITE: "true" }, "DB_USE_SQLITE"],
    ["schema synchronization", { DB_SYNCHRONIZE: "true" }, "DB_SYNCHRONIZE"],
    ["wildcard CORS", { CORS_ORIGIN: "*" }, "CORS_ORIGIN"],
    ["HTTP CORS", { CORS_ORIGIN: "http://app.example.com" }, "CORS_ORIGIN"],
    [
      "test injection",
      { TELEGRAM_TEST_INJECT_ENABLED: "true" },
      "TELEGRAM_TEST_INJECT_ENABLED",
    ],
  ])("rejects %s", (_name, overrides, expectedMessage) => {
    expect(() => validateEnvironment(productionEnvironment(overrides))).toThrow(
      expectedMessage,
    );
  });

  it("requires migration and reconciliation controls before enabling money egress", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          MONEY_EGRESS_ENABLED: "true",
        }),
      ),
    ).toThrow(/DB_MIGRATIONS_RUN/);
  });

  it("accepts TON Connect only with an explicit proof host and supported network", () => {
    const environment = productionEnvironment({
      TON_CONNECT_ENABLED: "true",
      TON_CONNECT_PROOF_DOMAIN: "app.example.com",
      TON_CONNECT_NETWORK: "-239",
    });

    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    [{ TON_CONNECT_ENABLED: "true" }, "TON_CONNECT_PROOF_DOMAIN"],
    [
      {
        TON_CONNECT_ENABLED: "true",
        TON_CONNECT_PROOF_DOMAIN: "https://app.example.com/path",
        TON_CONNECT_NETWORK: "-239",
      },
      "TON_CONNECT_PROOF_DOMAIN",
    ],
    [
      {
        TON_CONNECT_ENABLED: "true",
        TON_CONNECT_PROOF_DOMAIN: "app.example.com",
        TON_CONNECT_NETWORK: "-1",
      },
      "TON_CONNECT_NETWORK",
    ],
  ])(
    "rejects unsafe TON Connect production configuration",
    (overrides, message) => {
      expect(() =>
        validateEnvironment(productionEnvironment(overrides)),
      ).toThrow(message);
    },
  );

  it("requires migrations and both independent TON sources for production ingestion", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({ TON_NATIVE_INGESTION_ENABLED: "true" }),
      ),
    ).toThrow(/DB_MIGRATIONS_RUN/);

    expect(() =>
      validateEnvironment(
        productionEnvironment({
          TON_NATIVE_INGESTION_ENABLED: "true",
          DB_MIGRATIONS_RUN: "true",
          TONCENTER_API_KEY: "production-toncenter-key",
        }),
      ),
    ).toThrow(/TON_NATIVE_RECONCILIATION_REQUIRED/);

    const environment = productionEnvironment({
      TON_NATIVE_INGESTION_ENABLED: "true",
      DB_MIGRATIONS_RUN: "true",
      TONCENTER_API_KEY: "production-toncenter-key",
      TON_NATIVE_RECONCILIATION_REQUIRED: "true",
      TON_LITESERVER_V2_BASE_URL: "https://ton-v2.example.com/api/v2",
      TON_LITESERVER_V2_SOURCE: "selfhosted-liteserver-a",
      TON_LITESERVER_V2_API_KEY: "production-liteserver-key",
    });
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it("rejects an insecure TON Center override in production", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          TON_NATIVE_INGESTION_ENABLED: "true",
          DB_MIGRATIONS_RUN: "true",
          TONCENTER_API_KEY: "production-toncenter-key",
          TON_NATIVE_RECONCILIATION_REQUIRED: "true",
          TON_LITESERVER_V2_BASE_URL: "https://ton-v2.example.com/api/v2",
          TON_LITESERVER_V2_SOURCE: "selfhosted-liteserver-a",
          TON_LITESERVER_V2_API_KEY: "production-liteserver-key",
          TONCENTER_V3_BASE_URL: "http://toncenter.internal/api/v3",
        }),
      ),
    ).toThrow(/TONCENTER_V3_BASE_URL/);
  });

  it("rejects a primary-provider URL as independent TON reconciliation", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          TON_NATIVE_INGESTION_ENABLED: "true",
          DB_MIGRATIONS_RUN: "true",
          TONCENTER_API_KEY: "production-toncenter-key",
          TON_NATIVE_RECONCILIATION_REQUIRED: "true",
          TON_LITESERVER_V2_BASE_URL: "https://toncenter.com/api/v2",
          TON_LITESERVER_V2_SOURCE: "not-independent",
          TON_LITESERVER_V2_API_KEY: "production-liteserver-key",
        }),
      ),
    ).toThrow(/TON_LITESERVER_V2_BASE_URL/);
  });

  it("rejects an unsafe native TON manual-review polling interval", () => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          TON_NATIVE_MANUAL_REVIEW_CHECK_INTERVAL_MS: "10",
        }),
      ),
    ).toThrow(/TON_NATIVE_MANUAL_REVIEW_CHECK_INTERVAL_MS/);
  });
});
