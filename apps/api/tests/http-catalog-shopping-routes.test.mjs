import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer } from "../dist/http.js";
import { CatalogController } from "../dist/catalog/controller.js";
import { CatalogService } from "../dist/catalog/service.js";
import { CatalogWorkflowService } from "../dist/catalog/workflow.js";
import { ShoppingController } from "../dist/shopping/controller.js";
import { ShoppingService } from "../dist/shopping/service.js";
import { createTestTokenVerifier } from "../dist/identity/oidc.js";

// End-to-end tests of the catalog and shopping HTTP surfaces wired into
// apps/api/src/http.ts, mirroring http-family-routes.test.mjs and
// http-inventory-routes.test.mjs: a real node:http server, real fetch()
// calls, and (where relevant) a real signed JWT verified against a local
// JWKS. In-memory fakes stand in for the Postgres repositories, which have
// their own separate coverage in catalog-postgres.test.mjs /
// shopping-postgres.test.mjs.

const issuer = "https://issuer.example.test/realms/dispensa";
const audience = "dispensa-api";

async function buildVerifierAndToken() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  const verifier = createTestTokenVerifier(issuer, audience, {
    keys: [{ ...publicJwk, alg: "RS256", use: "sig" }],
  });
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
  return { verifier, bearerToken };
}

function buildCatalogController() {
  const products = new Map();
  const repository = {
    async createManualProductAtomic(input) {
      products.set(input.product.id, input.product);
      return input.product;
    },
  };
  const lookup = {
    async findByIdentifier({ normalizedValue }) {
      return [...products.values()].find((p) => p.canonicalName === normalizedValue);
    },
  };
  const candidates = { async applyImportedCandidate(input) { return input.candidate; } };
  let sequence = 0;
  const ids = { next: () => `product-${(sequence += 1)}` };
  const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };
  const service = new CatalogService(repository, ids, clock);
  const workflow = new CatalogWorkflowService(lookup, candidates);
  return new CatalogController(service, workflow);
}

function buildShoppingController() {
  const lists = new Map();
  const repository = {
    async createListAtomic(input) {
      const list = { id: input.id, familyId: input.familyId, ownerUserId: input.ownerUserId, name: input.name, status: "ACTIVE", version: 1 };
      lists.set(list.id, list);
      return list;
    },
    async addItemAtomic(input) {
      return {
        item: {
          id: input.id,
          listId: input.listId,
          productId: input.productId,
          displayName: input.displayName,
          quantity: input.quantity,
          unit: input.unit,
          packageId: input.packageId,
          state: "SUGGESTED",
          sourceType: input.sourceType,
          sourceRef: input.sourceRef,
          version: 1,
        },
        merged: false,
      };
    },
  };
  const memberships = {
    async getMembership() {
      return { familyId: "family-1", userId: "user-1", role: "OWNER", status: "ACTIVE" };
    },
  };
  let sequence = 0;
  const ids = { next: () => `list-${(sequence += 1)}` };
  const service = new ShoppingService(repository, ids);
  return new ShoppingController(service, memberships);
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

test("POST /api/v1/catalog/products creates a product over real HTTP", async () => {
  const { verifier, bearerToken } = await buildVerifierAndToken();
  const controller = buildCatalogController();
  await withServer({ version: "test", profile: "test", catalog: { controller, verifier } }, async (baseUrl) => {
    const token = await bearerToken();
    const response = await fetch(`${baseUrl}/api/v1/catalog/products`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ canonicalName: "Pasta di semola", defaultUnit: "g" }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.canonicalName, "Pasta di semola");
  });
});

test("GET /api/v1/catalog/lookup is public (no auth) and returns UNKNOWN for unmatched barcode", async () => {
  const { verifier } = await buildVerifierAndToken();
  const controller = buildCatalogController();
  await withServer({ version: "test", profile: "test", catalog: { controller, verifier } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/catalog/lookup?identifierType=EAN13&value=8001234567890`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, "UNKNOWN");
  });
});

test("GET /api/v1/catalog/lookup rejects missing query params with 400", async () => {
  const { verifier } = await buildVerifierAndToken();
  const controller = buildCatalogController();
  await withServer({ version: "test", profile: "test", catalog: { controller, verifier } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/catalog/lookup`);
    assert.equal(response.status, 400);
  });
});

test("POST /api/v1/shopping/lists creates a list, then POST .../items adds an item", async () => {
  const { verifier, bearerToken } = await buildVerifierAndToken();
  const controller = buildShoppingController();
  await withServer({ version: "test", profile: "test", shopping: { controller, verifier } }, async (baseUrl) => {
    const token = await bearerToken();
    const listResponse = await fetch(`${baseUrl}/api/v1/shopping/lists`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ familyId: "family-1", name: "Spesa settimanale" }),
    });
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.data.name, "Spesa settimanale");

    const itemResponse = await fetch(`${baseUrl}/api/v1/shopping/lists/${listBody.data.id}/items`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: "family-1",
        displayName: "Latte",
        quantity: 2,
        unit: "l",
        sourceType: "MANUAL",
      }),
    });
    const itemBody = await itemResponse.json();
    assert.equal(itemResponse.status, 200);
    assert.equal(itemBody.data.item.displayName, "Latte");
  });
});

test("catalog and shopping routes are absent (404) when not configured", async () => {
  await withServer({ version: "test", profile: "test" }, async (baseUrl) => {
    const catalogResponse = await fetch(`${baseUrl}/api/v1/catalog/products`, { method: "POST" });
    assert.equal(catalogResponse.status, 404);
    const shoppingResponse = await fetch(`${baseUrl}/api/v1/shopping/lists`, { method: "POST" });
    assert.equal(shoppingResponse.status, 404);
  });
});
