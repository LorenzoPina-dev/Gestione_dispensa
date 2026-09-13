import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer } from "../dist/http.js";
import { InventoryController } from "../dist/inventory/controller.js";
import { InventoryService } from "../dist/inventory/service.js";
import { createTestTokenVerifier } from "../dist/identity/oidc.js";

// End-to-end test of the inventory HTTP surface wired into
// apps/api/src/http.ts, mirroring http-family-routes.test.mjs: a real
// node:http server, a real signed JWT verified against a local JWKS, and
// real fetch() calls. In-memory fakes stand in for the Postgres repository
// (that boundary already has its own coverage in inventory-postgres.test.mjs
// and the family equivalent's live-Postgres integration test); this file's
// job is proving the routing, If-Match/optimistic-concurrency handling, and
// error mapping added to http.ts.

const issuer = "https://issuer.example.test/realms/dispensa";
const audience = "dispensa-api";

async function buildInventoryDependencies() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  const verifier = createTestTokenVerifier(issuer, audience, {
    keys: [{ ...publicJwk, alg: "RS256", use: "sig" }],
  });

  const stockItems = new Map();
  const movements = [];
  const repository = {
    async createStockItemAtomic(input) {
      const item = {
        id: input.id,
        familyId: input.familyId,
        productId: input.productId,
        quantity: input.quantity,
        unit: input.unit,
        reorderPoint: input.reorderPoint,
        version: 1,
        status: "ACTIVE",
      };
      stockItems.set(item.id, item);
      return item;
    },
    async recordMovementAtomic(input) {
      const current = stockItems.get(input.stockItemId);
      if (current === undefined) throw new Error("Stock item is not visible.");
      const delta =
        input.kind === "RECEIPT" ? input.quantity : input.kind === "CONSUMPTION" ? -input.quantity : 0;
      const updated = { ...current, quantity: current.quantity + delta, version: current.version + 1 };
      stockItems.set(input.stockItemId, updated);
      const movementId = `movement-${movements.length + 1}`;
      movements.push({ movementId, input });
      return { stockItem: updated, movementId, duplicate: false };
    },
  };
  const memberships = {
    async getMembership() {
      return { familyId: "family-1", userId: "user-1", role: "OWNER", status: "ACTIVE" };
    },
  };
  const reader = {
    async getStockItem(id) {
      const item = stockItems.get(id);
      return item === undefined ? undefined : { familyId: item.familyId, version: item.version };
    },
  };

  let sequence = 0;
  const ids = { next: () => `stock-${(sequence += 1)}` };
  const inventory = new InventoryService(repository, ids);
  const controller = new InventoryController(inventory, memberships, reader);

  async function bearerToken() {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ realm_access: { roles: ["MEMBER"] } })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("user-1")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }

  return { controller, verifier, bearerToken, stockItems };
}

async function withServer(options, callback) {
  const server = createApiServer(options);
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

test("POST /api/v1/inventory/stock-items creates a stock item over real HTTP", async () => {
  const { controller, verifier, bearerToken } = await buildInventoryDependencies();
  await withServer(
    { version: "test", profile: "test", inventory: { controller, verifier } },
    async (baseUrl) => {
      const token = await bearerToken();
      const response = await fetch(`${baseUrl}/api/v1/inventory/stock-items`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          familyId: "family-1",
          productId: "product-1",
          quantity: 3,
          unit: "piece",
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.data.quantity, 3);
      assert.equal(body.data.version, 1);
    },
  );
});

test("recording a movement without If-Match returns 428", async () => {
  const { controller, verifier, bearerToken } = await buildInventoryDependencies();
  await withServer(
    { version: "test", profile: "test", inventory: { controller, verifier } },
    async (baseUrl) => {
      const token = await bearerToken();
      const response = await fetch(`${baseUrl}/api/v1/inventory/stock-items/stock-1/movements`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          familyId: "family-1",
          kind: "RECEIPT",
          quantity: 1,
          unit: "piece",
          source: "manual",
          clientOperationId: "op-1",
          occurredAt: new Date().toISOString(),
        }),
      });
      assert.equal(response.status, 428);
    },
  );
});

test("recording a movement with a stale If-Match returns 409 VERSION_CONFLICT", async () => {
  const { controller, verifier, bearerToken } = await buildInventoryDependencies();
  await withServer(
    { version: "test", profile: "test", inventory: { controller, verifier } },
    async (baseUrl) => {
      const token = await bearerToken();
      const created = await fetch(`${baseUrl}/api/v1/inventory/stock-items`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          familyId: "family-1",
          productId: "product-1",
          quantity: 3,
          unit: "piece",
        }),
      });
      const createdBody = await created.json();
      const stockItemId = createdBody.data.id;

      const response = await fetch(
        `${baseUrl}/api/v1/inventory/stock-items/${stockItemId}/movements`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "if-match": "99",
          },
          body: JSON.stringify({
            familyId: "family-1",
            kind: "RECEIPT",
            quantity: 1,
            unit: "piece",
            source: "manual",
            clientOperationId: "op-1",
            occurredAt: new Date().toISOString(),
          }),
        },
      );
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.error.code, "VERSION_CONFLICT");
    },
  );
});

test("recording a movement with the correct If-Match succeeds and updates quantity", async () => {
  const { controller, verifier, bearerToken } = await buildInventoryDependencies();
  await withServer(
    { version: "test", profile: "test", inventory: { controller, verifier } },
    async (baseUrl) => {
      const token = await bearerToken();
      const created = await fetch(`${baseUrl}/api/v1/inventory/stock-items`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          familyId: "family-1",
          productId: "product-1",
          quantity: 3,
          unit: "piece",
        }),
      });
      const createdBody = await created.json();
      const stockItemId = createdBody.data.id;

      const response = await fetch(
        `${baseUrl}/api/v1/inventory/stock-items/${stockItemId}/movements`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "if-match": "1",
          },
          body: JSON.stringify({
            familyId: "family-1",
            kind: "RECEIPT",
            quantity: 2,
            unit: "piece",
            source: "manual",
            clientOperationId: "op-1",
            occurredAt: new Date().toISOString(),
          }),
        },
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.data.stockItem.quantity, 5);
      assert.equal(body.data.stockItem.version, 2);
    },
  );
});

test("inventory routes are absent (404) when options.inventory is not provided", async () => {
  await withServer({ version: "test", profile: "test" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/inventory/stock-items`, { method: "POST" });
    assert.equal(response.status, 404);
  });
});
