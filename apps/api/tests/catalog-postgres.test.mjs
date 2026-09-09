import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PostgresCatalogCandidateRepository,
  PostgresCatalogLookupRepository,
  PostgresCatalogRepository,
} from "../dist/catalog/postgres.js";

function transactionClient() {
  const calls = [];
  return {
    calls,
    async transaction() {
      return {
        async query(text, values = []) {
          calls.push({ text, values });
          if (text.includes("INSERT INTO data_sources")) return { rows: [{ id: "source-1" }] };
          if (text.includes("INSERT INTO brands")) return { rows: [{ id: "brand-1" }] };
          if (text.includes("INSERT INTO products") && text.includes("RETURNING id"))
            return { rows: [{ id: "product-imported" }] };
          return { rows: [] };
        },
        async commit() {
          calls.push({ text: "COMMIT", values: [] });
        },
        async rollback() {
          calls.push({ text: "ROLLBACK", values: [] });
        },
      };
    },
  };
}

test("manual catalog persistence writes product, provenance, and outbox in one transaction", async () => {
  const database = transactionClient();
  const product = {
    id: "product-1",
    canonicalName: "Pasta",
    brand: "Marca",
    defaultUnit: "pack",
    status: "ACTIVE",
    provenanceQuality: "VERIFIED",
    version: 1,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
  const repository = new PostgresCatalogRepository(database);
  await repository.createManualProductAtomic({
    product,
    provenance: {
      productId: product.id,
      source: "MANUAL",
      confidence: 1,
      observedAt: product.createdAt,
      sourceVersion: "manual-v1",
    },
    event: {
      eventId: "event-1",
      eventType: "catalog.product-updated",
      eventVersion: 1,
      aggregateType: "product",
      aggregateId: product.id,
      actorId: "user-1",
      traceId: "0123456789abcdef",
      changedFields: ["canonicalName"],
    },
  });
  assert.equal(database.calls.at(-1).text, "COMMIT");
  assert.equal(database.calls.filter((call) => call.text.includes("INSERT INTO")).length, 5);
});

test("catalog lookup maps joined product rows and preserves verified ordering", async () => {
  const repository = new PostgresCatalogLookupRepository({
    async query(text) {
      assert.match(text, /is_verified DESC/);
      return {
        rows: [
          {
            id: "product-1",
            canonical_name: "Pasta",
            brand: "Marca",
            default_unit: "pack",
            status: "ACTIVE",
            provenance_quality: "VERIFIED",
            version: 1,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      };
    },
  });
  const product = await repository.findByIdentifier({
    identifierType: "EAN13",
    normalizedValue: "8012345678901",
  });
  assert.equal(product?.canonicalName, "Pasta");
  assert.equal(product?.brand, "Marca");
});

test("imported candidate persists provenance and returns the generated product id", async () => {
  const database = transactionClient();
  const repository = new PostgresCatalogCandidateRepository(database);
  const candidate = await repository.applyImportedCandidate({
    candidate: {
      productId: undefined,
      canonicalName: "Pasta",
      brand: "Marca",
      defaultUnit: "pack",
      confidence: 0.7,
      source: "provider-1",
      requiresReview: true,
    },
    actorId: "operator-1",
    traceId: "0123456789abcdef",
  });
  assert.equal(candidate.productId, "product-imported");
  assert.equal(database.calls.at(-1).text, "COMMIT");
});
