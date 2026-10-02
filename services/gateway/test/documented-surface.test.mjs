import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

const port = 3398;
const base = "http://127.0.0.1:" + port;
const uuid = "00000000-0000-4000-8000-000000000001";
let identity;
let family;
let gateway;
let identityBase;
let familyBase;

function normalizePath(path) {
  return path
    .replaceAll("{familyId}", uuid)
    .replaceAll("{userId}", uuid)
    .replaceAll("{itemId}", uuid)
    .replaceAll("{productId}", uuid)
    .replaceAll("{storeId}", uuid)
    .replaceAll("{notificationId}", uuid)
    .replaceAll("{recipeId}", uuid)
    .replaceAll("{jobId}", uuid)
    .replaceAll("{draftId}", uuid)
    .replaceAll("{predictionId}", uuid)
    .replaceAll("{attemptId}", uuid)
    .replaceAll("{deadLetterId}", uuid)
    .replaceAll("{token}", "opaque-token")
    .replaceAll("{barcode}", "8001234567890");
}

function parseOperations(api) {
  return [...api.matchAll(/^###\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/gm)]
    .map((m) => ({ method: m[1], path: m[2].replaceAll("`", "") }));
}

async function request(path, init = {}) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { response, body };
}

before(async () => {
  identity = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/auth/register" && req.method === "POST") {
      res.statusCode = 201; res.end(JSON.stringify({ data: { success: true, message: "ok" } })); return;
    }
    if (req.url === "/api/v1/auth/reset-password" && req.method === "POST") {
      res.statusCode = 202; res.end(JSON.stringify({ data: { accepted: true, message: "ok" } })); return;
    }
    if (req.url === "/api/v1/auth/logout" && req.method === "POST") {
      res.statusCode = 204; res.end(); return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
  });
  family = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v1/family-invites/opaque-token" && req.method === "GET") {
      res.statusCode = 200;
      res.end(JSON.stringify({ data: { inviteId: uuid, familyName: "Test", role: "member", status: "pending", expiresAt: "2030-01-01T00:00:00Z" } }));
      return;
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
  });
  await new Promise((resolve) => identity.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => family.listen(0, "127.0.0.1", resolve));
  identityBase = "http://127.0.0.1:" + identity.address().port + "/api/v1";
  familyBase = "http://127.0.0.1:" + family.address().port + "/api/v1";

  gateway = spawn(process.execPath, ["dist/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      IDENTITY_SERVICE_BASE_URL: identityBase,
      FAMILY_SERVICE_BASE_URL: familyBase,
      OIDC_ISSUER: "http://127.0.0.1:1/realms/dispensa",
      OIDC_AUDIENCE: "account",
      OIDC_JWKS_URL: "http://127.0.0.1:1/realms/dispensa/protocol/openid-connect/certs",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let i = 0; i < 60; i += 1) {
    try {
      const health = await fetch(base + "/health/live");
      if (health.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Gateway did not start");
});

after(async () => {
  if (gateway && !gateway.killed) { gateway.kill("SIGTERM"); await once(gateway, "exit").catch(() => {}); }
  if (identity) await new Promise((resolve) => identity.close(() => resolve()));
  if (family) await new Promise((resolve) => family.close(() => resolve()));
});

describe("Gateway / documented API.md edge surface", () => {
  it("protects every documented browser operation except the four public authentication/invite routes", async () => {
    const api = await readFile("docs/API.md", "utf8");
    const publicRoutes = new Set([
      "POST /auth/register",
      "POST /auth/reset-password",
      "POST /auth/logout",
      "GET /family-invites/{token}",
    ]);
    const operations = parseOperations(api);
    let checked = 0;
    for (const operation of operations) {
      const logical = operation.method + " " + operation.path;
      if (publicRoutes.has(logical)) continue;
      if (operation.path.startsWith("/internal/")) continue;
      if (operation.path.startsWith("/health/")) continue;
      const result = await request(normalizePath("/api/v1" + operation.path), { method: operation.method });
      assert.equal(result.response.status, 401, logical);
      assert.equal(result.body?.error?.code, "UNAUTHENTICATED", logical);
      checked += 1;
    }
    assert.ok(checked >= 70);
  });

  it("keeps the documented public routes reachable", async () => {
    const expected = [
      ["POST", "/api/v1/auth/register", 201],
      ["POST", "/api/v1/auth/reset-password", 202],
      ["POST", "/api/v1/auth/logout", 204],
      ["GET", "/api/v1/family-invites/opaque-token", 200],
    ];
    for (const [method, path, status] of expected) {
      const result = await request(path, { method });
      assert.equal(result.response.status, status, method + " " + path);
    }
  });
});
