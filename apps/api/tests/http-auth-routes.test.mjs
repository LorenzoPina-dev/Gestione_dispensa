import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApiServer } from "../dist/http.js";

async function withServer(callback) {
  const server = createApiServer({
    version: "test",
    profile: "test",
    startedAt: "2026-01-01T00:00:00.000Z",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("POST /api/v1/auth/register rejects an invalid body with a canonical VALIDATION_ERROR envelope", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", email: "not-an-email", password: "short" }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "VALIDATION_ERROR");
  });
});

test("POST /api/v1/auth/register only allows POST", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, { method: "GET" });
    const body = await response.json();
    assert.equal(response.status, 405);
    assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
  });
});

test("POST /api/v1/auth/register creates the account when Keycloak accepts it", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("/protocol/openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "admin-token" }), { status: 200 });
    }
    if (href.includes("/admin/realms/")) {
      const parsedBody = JSON.parse(init.body);
      assert.equal(parsedBody.email, "giulia@example.it");
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected fetch in test: ${href}`);
  };
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Giulia Ferretti", email: "giulia@example.it", password: "password123" }),
      });
      const body = await response.json();
      assert.equal(response.status, 201);
      assert.deepEqual(body.data, { success: true, message: "Utente registrato con successo." });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/v1/auth/register maps a Keycloak 409 to USER_ALREADY_EXISTS", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("/protocol/openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "admin-token" }), { status: 200 });
    }
    return new Response(null, { status: 409 });
  };
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Giulia Ferretti", email: "giulia@example.it", password: "password123" }),
      });
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.error.code, "USER_ALREADY_EXISTS");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/v1/auth/logout always returns 204, even with no/invalid token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST" });
    assert.equal(response.status, 204);

    const withBadToken = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    assert.equal(withBadToken.status, 204);
  });
});

test("GET /api/v1/auth/logout is not allowed", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "GET" });
    const body = await response.json();
    assert.equal(response.status, 405);
    assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
  });
});
