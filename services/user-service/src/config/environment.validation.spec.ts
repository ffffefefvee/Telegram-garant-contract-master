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
});
