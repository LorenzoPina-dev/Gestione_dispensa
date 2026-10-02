import { describe, it } from "node:test";
import assert from "node:assert/strict";

const base = process.env.SHOPPING_TEST_URL ?? "http://127.0.0.1:3313";
const userId = process.env.SHOPPING_TEST_USER_ID ?? "00000000-0000-4000-8000-000000000001";
const familyId = process.env.SHOPPING_TEST_FAMILY_ID ?? "00000000-0000-4000-8000-000000000002";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

describe("service-shopping / HTTP endpoint contract", () => {
  it("GET /health/live works", async () => {
    const { response, body } = await request("/health/live");
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", service: "service-shopping" });
  });

  it("GET /health/ready checks PostgreSQL", async () => {
    const { response, body } = await request("/health/ready");
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ready", service: "service-shopping" });
  });

  it("requires family and user context for protected reads", async () => {
    const { response, body } = await request("/api/v1/shopping/lists");
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
  });

  it("requires idempotency on list creation", async () => {
    const { response, body } = await request("/api/v1/shopping/lists?familyId=" + familyId, {
      method: "POST",
      headers: { "x-user-id": userId, "content-type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
  });

  it("rejects too-short idempotency keys", async () => {
    const { response, body } = await request("/api/v1/shopping/lists", {
      method: "POST",
      headers: {
        "x-user-id": userId,
        "x-family-id": familyId,
        "x-idempotency-key": "short",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Test" }),
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
  });

  it("rejects unknown routes", async () => {
    const { response, body } = await request("/api/v1/shopping/unknown", {
      headers: { "x-user-id": userId, "x-family-id": familyId },
    });
    assert.equal(response.status, 404);
    assert.equal(body?.error?.code, "NOT_FOUND");
  });
});
