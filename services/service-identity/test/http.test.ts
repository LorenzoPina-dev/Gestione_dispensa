import { describe, it } from "node:test";
import assert from "node:assert/strict";

const base = process.env.IDENTITY_TEST_URL ?? "http://127.0.0.1:3310";

async function json(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  let body: unknown = undefined;
  const text = await response.text();
  if (text) body = JSON.parse(text);
  return { response, body };
}

describe("service-identity / HTTP endpoint contract", () => {
  it("GET /health/live is live and identifies the service", async () => {
    const { response, body } = await json("/health/live");
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", service: "service-identity" });
    assert.ok(response.headers.get("x-request-id"));
  });

  it("GET /api/v1/meta returns service metadata", async () => {
    const { response, body } = await json("/api/v1/meta");
    assert.equal(response.status, 200);
    assert.equal((body as any).data.service, "service-identity");
    assert.ok((body as any).data.version);
  });

  it("rejects malformed registration before touching Keycloak", async () => {
    const { response, body } = await json("/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", email: "bad", password: "short" }),
    });
    assert.equal(response.status, 400);
    assert.equal((body as any).error.code, "VALIDATION_ERROR");
    assert.ok((body as any).error.requestId);
  });

  it("returns 400 for malformed JSON", async () => {
    const { response, body } = await json("/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    assert.equal(response.status, 400);
    assert.equal((body as any).error.code, "VALIDATION_ERROR");
  });

  it("requires authenticated user context for profile", async () => {
    const { response, body } = await json("/api/v1/identity/me");
    assert.equal(response.status, 401);
    assert.equal((body as any).error.code, "UNAUTHENTICATED");
  });

  it("rejects invalid authenticated user ids", async () => {
    const { response, body } = await json("/api/v1/identity/me", {
      headers: { "x-user-id": "not-a-uuid" },
    });
    assert.equal(response.status, 401);
    assert.equal((body as any).error.code, "UNAUTHENTICATED");
  });

  it("returns 404 for unknown routes", async () => {
    const { response, body } = await json("/api/v1/does-not-exist");
    assert.equal(response.status, 404);
    assert.equal((body as any).error.code, "NOT_FOUND");
  });

  it("rejects undocumented profile fields and missing idempotency", async () => {
    const missingKey = await json("/api/v1/identity/me", {
      method: "PATCH",
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001", "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Mario" }),
    });
    assert.equal(missingKey.response.status, 400);
    assert.equal((missingKey.body as any).error.code, "VALIDATION_ERROR");

    const undocumented = await json("/api/v1/identity/me", {
      method: "PATCH",
      headers: {
        "x-user-id": "00000000-0000-4000-8000-000000000001",
        "x-idempotency-key": "profile-12345678",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Mario" }),
    });
    assert.equal(undocumented.response.status, 400);
    assert.equal((undocumented.body as any).error.code, "VALIDATION_ERROR");
  });

  it("returns 204 for logout without a server session", async () => {
    const { response } = await json("/api/v1/auth/logout", { method: "POST" });
    assert.equal(response.status, 204);
  });
});
