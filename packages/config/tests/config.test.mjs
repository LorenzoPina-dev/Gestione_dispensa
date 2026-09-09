import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigValidationError, loadConfig } from "../src/index.ts";

function validEnvironment(overrides = {}) {
  return {
    APP_ENV: "family-local",
    APP_VERSION: "0.1.0-test",
    PUBLIC_BASE_URL: "http://localhost:3000",
    API_BASE_URL: "http://localhost:3000/api/v1",
    OIDC_ISSUER_URL: "http://localhost:8080/realms/dispensa",
    OIDC_CLIENT_SECRET_REF: "secret://oidc/client",
    SESSION_SECRET_REF: "secret://session",
    DATABASE_URL_REF: "secret://postgres/url",
    REDIS_URL_REF: "secret://redis/url",
    OBJECT_STORAGE_CREDENTIAL_REF: "secret://minio/credentials",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    ALERTMANAGER_URL: "http://localhost:9093",
    ...overrides,
  };
}

test("loadConfig validates family-local configuration and returns a safe fingerprint", () => {
  const result = loadConfig(validEnvironment());

  assert.equal(result.config.appEnv, "family-local");
  assert.equal(result.config.cookieSecure, false);
  assert.equal(result.fingerprint.length, 32);
  assert.ok(!result.fingerprint.includes("secret://"));
});

test("loadConfig rejects raw secret values", () => {
  assert.throws(
    () =>
      loadConfig(validEnvironment({ DATABASE_URL_REF: "postgres://user:password@localhost/db" })),
    (error) =>
      error instanceof ConfigValidationError &&
      error.issues.includes("DATABASE_URL_REF must be a secret:// reference"),
  );
});

test("loadConfig rejects enabled AI without a daily budget", () => {
  assert.throws(
    () => loadConfig(validEnvironment({ AI_PROVIDER: "local-model" })),
    (error) =>
      error instanceof ConfigValidationError &&
      error.issues.includes("AI_BUDGET_DAILY_MINOR must be positive when AI_PROVIDER is enabled"),
  );
});

test("loadConfig rejects localhost CORS in production", () => {
  assert.throws(
    () =>
      loadConfig(
        validEnvironment({ APP_ENV: "production", CORS_ALLOWED_ORIGINS: "http://localhost:3000" }),
      ),
    (error) =>
      error instanceof ConfigValidationError &&
      error.issues.includes("CORS_ALLOWED_ORIGINS cannot use localhost in production"),
  );
});
