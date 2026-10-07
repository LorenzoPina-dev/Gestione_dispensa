import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CatalogWorkflowService,
  type CatalogCandidateRepository,
  type CatalogLookupRepository,
  type ExternalBarcodeLookupClient,
  type ExternalProductSearchClient,
} from "../src/catalog/workflow.js";
import type { Product } from "../src/catalog/service.js";

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "00000000-0000-4000-8000-000000000001",
  canonicalName: "Latte intero",
  brand: "Marca",
  defaultUnit: "g",
  status: "ACTIVE",
  provenanceQuality: "IMPORTED",
  version: 1,
  quantityValue: 1000,
  quantityUnit: "g",
  quantityLabel: "1 kg",
  images: { front: "https://example.test/front.jpg" },
  calories: 62,
  protein: 3.2,
  carbs: 4.8,
  fat: 3.5,
  fiber: 0,
  openFoodFacts: { product_quantity: 1000, product_quantity_unit: "g" },
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  barcodes: ["8001234567890"],
  externalSource: "openfoodfacts",
  externalRef: "8001234567890",
  ...overrides,
});

const candidates: CatalogCandidateRepository = {
  applyImportedCandidate: async ({ candidate }) => candidate,
};

describe("catalog workflow", () => {
  it("returns a complete local match without calling the provider", async () => {
    let externalCalls = 0;
    const lookup: CatalogLookupRepository = {
      findByIdentifier: async () => product(),
      persistExternalMatch: async () => { throw new Error("must not persist"); },
      refreshExternalMatch: async () => { throw new Error("must not refresh"); },
    };
    const external: ExternalBarcodeLookupClient = {
      lookup: async () => { externalCalls += 1; return undefined; },
    };

    const workflow = new CatalogWorkflowService(lookup, candidates, external);
    const result = await workflow.resolveBarcode("BARCODE", "8001234567890", "trace-1234567890123456");

    assert.equal(result.status, "MATCHED");
    assert.equal(result.resolution, "cache");
    assert.equal(result.product?.canonicalName, "Latte intero");
    assert.equal(externalCalls, 0);
  });

  it("persists an external match when the barcode is unknown locally", async () => {
    let persisted = 0;
    const lookup: CatalogLookupRepository = {
      findByIdentifier: async () => undefined,
      persistExternalMatch: async ({ match }) => {
        persisted += 1;
        return product({
          canonicalName: match.canonicalName,
          version: 2,
        } as never);
      },
      refreshExternalMatch: async () => { throw new Error("must not refresh"); },
    };
    const external: ExternalBarcodeLookupClient = {
      lookup: async () => ({
        canonicalName: "Golia",
        brand: "Perfetti",
        defaultUnit: "g",
        quantityValue: 90,
        quantityUnit: "g",
        quantityLabel: "90 g",
        category: "confectionery-candy",
        images: { front: "https://example.test/golia.jpg" },
        openFoodFacts: { code: "8003440108888", quantity: "90 g" },
        sourceRef: "8003440108888",
        source: "openfoodfacts",
        sourceVersion: "off-canonical-v1-cache",
        confidence: 0.95,
      }),
    };

    const workflow = new CatalogWorkflowService(lookup, candidates, external);
    const result = await workflow.resolveBarcode("BARCODE", "8003440108888", "trace-1234567890123456");

    assert.equal(result.status, "MATCHED");
    assert.equal(result.resolution, "cache");
    assert.equal(result.normalizedValue, "8003440108888");
    assert.equal(result.product?.canonicalName, "Golia");
    assert.equal(persisted, 1);
  });

  it("falls back to external search only for normalized queries of three characters or more", async () => {
    const calls: string[] = [];
    const search: ExternalProductSearchClient = {
      search: async ({ query, limit }) => {
        calls.push(query + ":" + limit);
        return [{ code: "8001234567890", canonicalName: "Latte intero", confidence: 0.9, defaultUnit: "g", source: "off", requiresReview: true } as never];
      },
    };
    const workflow = new CatalogWorkflowService(
      {
        findByIdentifier: async () => undefined,
        persistExternalMatch: async () => product(),
        refreshExternalMatch: async () => product(),
      },
      candidates,
      undefined,
      search,
    );

    assert.deepEqual(await workflow.searchProducts("  la  ", "trace-1234567890123456", 8), []);
    const hits = await workflow.searchProducts("  latte  ", "trace-1234567890123456", 50);
    assert.equal(hits?.length, 1);
    assert.deepEqual(calls, ["latte:20"]);
  });
});
