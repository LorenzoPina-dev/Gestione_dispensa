import { describe, it } from "node:test";
import assert from "node:assert/strict";

const base = process.env.RECIPES_TEST_URL ?? "http://127.0.0.1:3401";
const userId = process.env.RECIPES_TEST_USER_ID ?? "00000000-0000-4000-8000-000000000001";
const familyId = process.env.RECIPES_TEST_FAMILY_ID ?? "00000000-0000-4000-8000-000000000002";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

describe("service-recipes / HTTP endpoint contract", () => {
  it("GET /health/live is public", async () => {
    const { response, body } = await request("/health/live");
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", service: "service-recipes" });
  });

  it("GET /health/ready checks real PostgreSQL", async () => {
    const { response } = await request("/health/ready");
    assert.equal(response.status, 200);
  });

  it("rejects protected list access without context", async () => {
    const { response, body } = await request("/api/v1/recipes");
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
  });

  it("requires idempotency for creation", async () => {
    const { response, body } = await request("/api/v1/recipes?familyId=" + familyId, {
      method: "POST",
      headers: { "x-user-id": userId, "content-type": "application/json" },
      body: JSON.stringify({ title: "Pasta", servings: 2, ingredients: [], steps: [] }),
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
  });

  it("rejects unknown routes", async () => {
    const { response, body } = await request("/api/v1/recipes/unknown/path", {
      headers: { "x-user-id": userId, "x-family-id": familyId },
    });
    assert.equal(response.status, 404);
    assert.equal(body?.error?.code, "NOT_FOUND");
  });
});
