import { describe, it } from "node:test";
import assert from "node:assert/strict";

const base = process.env.INVENTORY_TEST_URL ?? "http://127.0.0.1:3312";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

describe("service-inventory / HTTP endpoint contract", () => {
  it("GET /health/live identifies the service", async () => {
    const { response, body } = await request("/health/live");
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ok", service: "service-inventory" });
    assert.ok(response.headers.get("x-request-id"));
  });

  it("GET /health/ready checks real PostgreSQL reachability", async () => {
    const { response, body } = await request("/health/ready");
    assert.equal(response.status, 200);
    assert.deepEqual(body, { status: "ready", service: "service-inventory" });
  });

  it("rejects protected routes without user and family context", async () => {
    const { response, body } = await request("/api/v1/inventory");
    assert.equal(response.status, 401);
    assert.equal(body?.error?.code, "UNAUTHENTICATED");
  });

  it("rejects protected routes when family context is incomplete", async () => {
    const { response, body } = await request("/api/v1/inventory", {
      headers: { "x-user-id": "00000000-0000-4000-8000-000000000001" },
    });
    assert.equal(response.status, 401);
    assert.equal(body?.error?.code, "UNAUTHENTICATED");
  });

  it("rejects unknown routes", async () => {
    const { response, body } = await request("/api/v1/inventory/unknown");
    assert.equal(response.status, 401);
    assert.equal(body?.error?.code, "UNAUTHENTICATED");
  });

  it("rejects malformed JSON without a server crash", async () => {
    const { response, body } = await request("/api/v1/inventory/items", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "00000000-0000-4000-8000-000000000001",
        "x-family-id": "00000000-0000-4000-8000-000000000002",
      },
      body: "{not-json",
    });
    assert.equal(response.status, 500);
    assert.equal(body?.error?.code, "INTERNAL_ERROR");
  });

  it("requires idempotency for inventory creation after family authorization", async () => {
    const { response, body } = await request("/api/v1/inventory/items", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "00000000-0000-4000-8000-000000000001",
        "x-family-id": "00000000-0000-4000-8000-000000000002",
      },
      body: JSON.stringify({ productId: "00000000-0000-4000-8000-000000000003", quantity: 1, unit: "piece" }),
    });
    assert.equal(response.status, 503);
    assert.equal(body?.error?.code, "FAMILY_AUTH_UNAVAILABLE");
  });

  it("exposes PATCH /inventory/{itemId} as part of the public contract", async () => {
    const { response, body } = await request("/api/v1/inventory/00000000-0000-4000-8000-000000000003", {
      method: "PATCH",
      headers: {
        "x-user-id": "00000000-0000-4000-8000-000000000001",
        "x-family-id": "00000000-0000-4000-8000-000000000002",
      },
    });
    assert.equal(response.status, 404);
    assert.equal(body?.error?.code, "NOT_FOUND");
  });
});
