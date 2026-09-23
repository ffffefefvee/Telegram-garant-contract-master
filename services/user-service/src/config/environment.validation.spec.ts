import { validateEnvironment } from "./environment.validation";
import { generateKeyPairSync } from "crypto";

function ed25519PublicKeyBase64(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  return Buffer.from(
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  ).toString("base64");
}

const SCANNER_PUBLIC_KEY = ed25519PublicKeyBase64();

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
    ADMIN_ALLOWED_ORIGINS: "https://admin.example.com",
    ARBITRATOR_ALLOWED_ORIGINS: "https://arbitrator.example.com",
    ADMIN_STEP_UP_ISSUER: "https://identity.example.com",
    ADMIN_STEP_UP_AUDIENCE: "telegram-garant-admin",
    ADMIN_STEP_UP_MAX_AGE_SECONDS: "300",
    ADMIN_STEP_UP_JWKS_URL: "https://identity.example.com/admin/jwks",
    ADMIN_STEP_UP_JWKS_CACHE_SECONDS: "300",
    ADMIN_STEP_UP_INTROSPECTION_URL: "https://identity.example.com/admin/introspect",
    ADMIN_STEP_UP_INTROSPECTION_TOKEN: "admin-introspection-secret",
    ADMIN_STEP_UP_REQUIRED_SCOPE: "garant:admin:step-up",
    ADMIN_STEP_UP_REQUIRED_ACR: "urn:garant:acr:phishing-resistant",
    ADMIN_STEP_UP_IDP_TIMEOUT_MS: "2000",
    ARBITRATOR_STEP_UP_ISSUER: "https://identity.example.com",
    ARBITRATOR_STEP_UP_AUDIENCE: "telegram-garant-arbitrator",
    ARBITRATOR_STEP_UP_MAX_AGE_SECONDS: "300",
    ARBITRATOR_STEP_UP_JWKS_URL: "https://identity.example.com/arbitrator/jwks",
    ARBITRATOR_STEP_UP_JWKS_CACHE_SECONDS: "300",
    ARBITRATOR_STEP_UP_INTROSPECTION_URL: "https://identity.example.com/arbitrator/introspect",
    ARBITRATOR_STEP_UP_INTROSPECTION_TOKEN: "arbitrator-introspection-secret",
    ARBITRATOR_STEP_UP_REQUIRED_SCOPE: "garant:arbitrator:step-up",
    ARBITRATOR_STEP_UP_REQUIRED_ACR: "urn:garant:acr:phishing-resistant",
    ARBITRATOR_STEP_UP_IDP_TIMEOUT_MS: "2000",
    EVIDENCE_PIPELINE_ENABLED: "true",
    EVIDENCE_S3_REGION: "eu-central-1",
    EVIDENCE_S3_QUARANTINE_BUCKET: "garant-evidence-quarantine",
    EVIDENCE_S3_CLEAN_BUCKET: "garant-evidence-clean",
    EVIDENCE_S3_KMS_KEY_ID: "arn:aws:kms:eu-central-1:123456789012:key/test",
    EVIDENCE_SCANNER_URL: "https://scanner.example.com/v1/scan",
    EVIDENCE_SCANNER_API_TOKEN: "scanner-production-secret",
    EVIDENCE_SCANNER_PUBLIC_KEY_BASE64: SCANNER_PUBLIC_KEY,
    EVIDENCE_SCANNER_TIMEOUT_MS: "30000",
    EVIDENCE_SCANNER_RESULT_MAX_AGE_SECONDS: "300",
    AUDIT_WORM_EXPORT_ENABLED: "true",
    AUDIT_WORM_S3_REGION: "eu-central-1",
    AUDIT_WORM_S3_BUCKET: "garant-offsite-audit-worm",
    AUDIT_WORM_S3_KMS_KEY_ID: "arn:aws:kms:eu-central-1:123456789012:key/worm",
    AUDIT_WORM_BATCH_SIZE: "500",
    AUDIT_WORM_RETENTION_DAYS: "2555",
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
      "shared privileged origin",
      { ARBITRATOR_ALLOWED_ORIGINS: "https://admin.example.com" },
      "separate origins",
    ],
    [
      "insecure JWKS endpoint",
      { ADMIN_STEP_UP_JWKS_URL: "http://identity.example.com/jwks" },
      "ADMIN_STEP_UP_JWKS_URL",
    ],
    [
      "insecure step-up issuer",
      { ADMIN_STEP_UP_ISSUER: "http://identity.example.com" },
      "ADMIN_STEP_UP_ISSUER",
    ],
    [
      "staging mock IdP in production",
      { ADMIN_STEP_UP_JWKS_URL: "https://127.0.0.1:9443/jwks" },
      "loopback fixture",
    ],
    [
      "shared step-up scope",
      {
        ARBITRATOR_STEP_UP_REQUIRED_SCOPE: "garant:admin:step-up",
      },
      "scopes must be distinct",
    ],
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

  it("accepts money egress only with Web3Signer, durable Polygon indexing and independent RPCs", () => {
    const environment = productionEnvironment({
      MONEY_EGRESS_ENABLED: "true",
      DB_MIGRATIONS_RUN: "true",
      RECONCILIATION_ENABLED: "true",
      RELAY_SIGNER: "web3signer",
      BLOCKCHAIN_CHAIN_ID: "80002",
      ESCROW_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
      PLATFORM_TREASURY_ADDRESS: "0x0000000000000000000000000000000000000002",
      ARBITRATOR_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000003",
      USDT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000004",
      WEB3SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
      WEB3SIGNER_RPC_URL: "http://web3signer.internal:8545",
      POLYGON_INDEXER_ENABLED: "true",
      POLYGON_RECONCILIATION_REQUIRED: "true",
      BLOCKCHAIN_RPC_URL: "https://rpc-a.example.com",
      BLOCKCHAIN_RPC_URLS: "https://rpc-b.example.net",
      POLYGON_FINALITY_CONFIRMATIONS: "128",
      POLYGON_RELAYER_MINIMUM_BALANCE_WEI: "100000000000000000",
    });
    expect(validateEnvironment(environment)).toBe(environment);
  });

  it.each([
    ["local signer", { RELAY_SIGNER: "local" }, "RELAY_SIGNER"],
    ["disabled indexer", { POLYGON_INDEXER_ENABLED: "false" }, "POLYGON_INDEXER_ENABLED"],
    [
      "missing independent reconciliation",
      { POLYGON_RECONCILIATION_REQUIRED: "false" },
      "POLYGON_RECONCILIATION_REQUIRED",
    ],
    [
      "one RPC operator",
      {
        BLOCKCHAIN_RPC_URL: "https://rpc-a.example.com",
        BLOCKCHAIN_RPC_URLS: "https://rpc-a.example.com/secondary",
      },
      "independent HTTPS Polygon RPC hosts",
    ],
    ["shallow finality", { POLYGON_FINALITY_CONFIRMATIONS: "16" }, "POLYGON_FINALITY_CONFIRMATIONS"],
    ["no relayer floor", { POLYGON_RELAYER_MINIMUM_BALANCE_WEI: "0" }, "POLYGON_RELAYER_MINIMUM_BALANCE_WEI"],
    ["zero token address", { USDT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000000" }, "USDT_CONTRACT_ADDRESS"],
    ["wrong chain", { BLOCKCHAIN_CHAIN_ID: "1" }, "BLOCKCHAIN_CHAIN_ID"],
    ["credentialed signer URL", { WEB3SIGNER_RPC_URL: "http://user:pass@signer.internal" }, "WEB3SIGNER_RPC_URL"],
  ])("rejects Polygon egress with %s", (_name, override, expected) => {
    expect(() =>
      validateEnvironment(
        productionEnvironment({
          MONEY_EGRESS_ENABLED: "true",
          DB_MIGRATIONS_RUN: "true",
          RECONCILIATION_ENABLED: "true",
          RELAY_SIGNER: "web3signer",
          BLOCKCHAIN_CHAIN_ID: "80002",
          ESCROW_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
          PLATFORM_TREASURY_ADDRESS: "0x0000000000000000000000000000000000000002",
          ARBITRATOR_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000003",
          USDT_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000004",
          WEB3SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
          WEB3SIGNER_RPC_URL: "http://web3signer.internal:8545",
          POLYGON_INDEXER_ENABLED: "true",
          POLYGON_RECONCILIATION_REQUIRED: "true",
          BLOCKCHAIN_RPC_URL: "https://rpc-a.example.com",
          BLOCKCHAIN_RPC_URLS: "https://rpc-b.example.net",
          POLYGON_FINALITY_CONFIRMATIONS: "128",
          POLYGON_RELAYER_MINIMUM_BALANCE_WEI: "100000000000000000",
          ...override,
        }),
      ),
    ).toThrow(expected);
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
