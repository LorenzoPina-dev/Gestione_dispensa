import { describe, it } from "node:test";
import assert from "node:assert/strict";

const base = process.env.FAMILY_TEST_URL ?? "http://127.0.0.1:3311";
const userId = process.env.FAMILY_TEST_USER_ID ?? "00000000-0000-4000-8000-000000000001";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

describe("service-family / endpoint contract", () => {
  it("GET /health/live exposes liveness without authentication", async () => {
    const { response, body } = await request("/health/live");
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", service: "service-family" });
    assert.ok(response.headers.get("x-request-id"));
  });

  it("GET /health/ready is a dependency readiness probe", async () => {
    const { response, body } = await request("/health/ready");
    assert.ok([200, 503].includes(response.status));
    if (response.status === 200) {
      assert.deepEqual(body, { status: "ready", service: "service-family" });
    }
  });

  it("rejects protected routes without authenticated context", async () => {
    const { response, body } = await request("/api/v1/families");
    assert.equal(response.status, 401);
    assert.equal(body?.error?.code, "UNAUTHENTICATED");
    assert.equal(body?.error?.retryable, false);
    assert.equal(body?.meta?.schemaVersion, "1.0");
    assert.ok(body?.error?.requestId);
  });

  it("requires idempotency before creating a family", async () => {
    const { response, body } = await request("/api/v1/families", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ name: "Test family" }),
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
    assert.match(body?.error?.message ?? "", /Idempotency/i);
  });

  it("validates the family name before persistence", async () => {
    const { response, body } = await request("/api/v1/families", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": userId,
        "x-idempotency-key": "family-validation-1",
      },
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
    assert.match(body?.error?.message ?? "", /name is required/i);
  });

  it("rejects an authenticated non-member before mutation", async () => {
    const familyId = "00000000-0000-4000-8000-000000000002";
    const { response, body } = await request(`/api/v1/families/${familyId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-user-id": userId,
        "x-idempotency-key": "family-patch-validation-1",
      },
      body: JSON.stringify({ name: "Renamed" }),
    });
    assert.equal(response.status, 403);
    assert.equal(body?.error?.code, "FORBIDDEN");
  });

  it("rejects unknown routes", async () => {
    const { response, body } = await request("/api/v1/family/unknown");
    assert.equal(response.status, 404);
    assert.equal(body?.error?.code, "NOT_FOUND");
  });
});

describe("service-family / malformed request contract", () => {
  it("returns 400 for malformed JSON instead of exposing an internal error", async () => {
    const { response, body } = await request("/api/v1/families", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": userId,
        "x-idempotency-key": "family-malformed-json-1",
      },
      body: "{not-json",
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
  });
});
