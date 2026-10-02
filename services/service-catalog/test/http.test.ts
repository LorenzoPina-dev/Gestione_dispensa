import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { CatalogService, type CatalogRepository, type Product } from "../src/catalog/service.js";
import { CatalogWorkflowService } from "../src/catalog/workflow.js";
import { CatalogController } from "../src/catalog/controller.js";
import { createTestTokenVerifier } from "../src/identity/oidc.js";
import { buildCatalogRouter } from "../src/http/routes/catalog.js";
import { corsMiddleware, requestMetaMiddleware } from "../src/http/middleware.js";

const userId = "integration-user";
const metaIssuer = "https://test-issuer.local/realms/dispensa";
const audience = "account";

class MemoryRepository implements CatalogRepository {
  private readonly products = new Map<string, Product>();

  async listActive(): Promise<Product[]> {
    return [...this.products.values()];
  }

  async getById(productId: string): Promise<Product | undefined> {
    return this.products.get(productId);
  }

  async createManualProductAtomic(input: { product: Product }): Promise<Product> {
    this.products.set(input.product.id, input.product);
    return input.product;
  }

  async updateProductAtomic(input: {
    productId: string;
    expectedVersion: number;
    patch: { name?: string; brand?: string | null; category?: string | null; imageObjectKey?: string | null; nutrition?: Record<string, unknown> | null };
  }): Promise<Product | undefined> {
    const current = this.products.get(input.productId);
    if (!current || current.version !== input.expectedVersion) return undefined;
    const updated = {
      ...current,
      canonicalName: input.patch.name ?? current.canonicalName,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.products.set(updated.id, updated);
    return updated;
  }
}

const repo = new MemoryRepository();
const service = new CatalogService(
  repo,
  (() => {
    let n = 0;
    return { next: () => `product-${++n}` };
  })(),
  { now: () => new Date("2026-10-02T00:00:00Z") },
);
const workflow = new CatalogWorkflowService(
  { findByIdentifier: async () => undefined, persistExternalMatch: async () => {
    throw new Error("unexpected external persistence");
  } },
  { applyImportedCandidate: async (input) => input.candidate },
);
const controller = new CatalogController(service, workflow);

let server: Server;
let base: string;
let authorization: string;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const verifier = createTestTokenVerifier(metaIssuer, audience, { keys: [{ ...jwk, alg: "RS256", use: "sig" }] });

  const token = await new SignJWT({
    email: "test@example.com",
    preferred_username: "test",
    scope: "openid profile",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(metaIssuer)
    .setAudience(audience)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  authorization = `Bearer ${token}`;

  const app = express();
  app.use(corsMiddleware());
  app.use(requestMetaMiddleware());
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1", buildCatalogRouter({ controller, verifier }));

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe("service-catalog / real Express HTTP adapter", () => {
  it("rejects protected requests without an OIDC token", async () => {
    const { response, body } = await request("/api/v1/catalog/products/product-1");
    assert.equal(response.status, 401);
    assert.equal(body?.error?.code, "UNAUTHENTICATED");
    assert.equal(body?.meta?.schemaVersion, "1.0");
    assert.ok(response.headers.get("traceparent"));
  });

  it("validates barcode path without touching persistence", async () => {
    const { response, body } = await request("/api/v1/catalog/barcodes/not-a-barcode", {
      headers: { authorization },
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
    assert.equal(repo["products"].size, 0);
  });

  it("requires idempotency for product creation", async () => {
    const { response, body } = await request("/api/v1/catalog/products", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "Latte", defaultUnit: "l" }),
    });
    assert.equal(response.status, 400);
    assert.equal(body?.error?.code, "VALIDATION_ERROR");
  });

  it("creates a manual product with the documented 201 status", async () => {
    const { response, body } = await request("/api/v1/catalog/products", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "x-idempotency-key": "catalog-create-1",
      },
      body: JSON.stringify({
        name: "  Latte intero ",
        brand: " Marca ",
        defaultUnit: "l",
        barcodes: ["8001234567890"],
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(body?.data?.name, "Latte intero");
    assert.equal(body?.data?.brand, "Marca");
    assert.deepEqual(body?.data?.barcodes, ["8001234567890"]);
    assert.equal(body?.version, 1);
  });

  it("returns 200 for the existing product GET and exposes the stored version", async () => {
    const { response, body } = await request("/api/v1/catalog/products/product-1", {
      headers: { authorization },
    });
    assert.equal(response.status, 200);
    assert.equal(body?.data?.productId, "product-1");
    assert.equal(body?.data?.version, 1);
  });

  it("returns 405 for a wrong method on a known route", async () => {
    const { response, body } = await request("/api/v1/catalog/products/product-1", {
      method: "DELETE",
      headers: { authorization },
    });
    assert.equal(response.status, 405);
    assert.equal(body?.error?.code, "METHOD_NOT_ALLOWED");
  });

  it("handles CORS preflight without authentication", async () => {
    const { response } = await request("/api/v1/catalog/products", {
      method: "OPTIONS",
      headers: { origin: "https://example.test" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://example.test");
  });
});
