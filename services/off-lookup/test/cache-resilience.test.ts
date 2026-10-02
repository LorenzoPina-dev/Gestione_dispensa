import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_CACHE_ENRICHMENT_VERSION,
  CURRENT_CACHE_SCHEMA_VERSION,
  mergeMissingFields,
  needsCacheEnrichment,
} from "../src/cache-policy.js";
import { ProductLookupService } from "../src/product-lookup-service.js";

const BARCODE = "8001234567890";

function currentMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    origin: "bulk-import",
    schemaVersion: CURRENT_CACHE_SCHEMA_VERSION,
    enrichmentVersion: CURRENT_CACHE_ENRICHMENT_VERSION,
    ...extra,
  };
}

describe("off-lookup resilient cache enrichment", () => {
  it("merges only missing fields, including nested fields, without overwriting cached values", () => {
    const cached = {
      product_name: "Cached name",
      brands: "Cached brand",
      nutriments: {
        energy_kcal_100g: 100,
        proteins_100g: 3,
      },
      images: {
        front: "cached-front.jpg",
      },
    };

    const fresh = {
      product_name: "Provider name",
      brands: "Provider brand",
      quantity: "500 ml",
      nutriments: {
        energy_kcal_100g: 999,
        carbohydrates_100g: 8,
        fat_100g: 4,
      },
      images: {
        front: "provider-front.jpg",
        ingredients: "provider-ingredients.jpg",
      },
    };

    assert.deepEqual(mergeMissingFields(cached, fresh), {
      product_name: "Cached name",
      brands: "Cached brand",
      quantity: "500 ml",
      nutriments: {
        energy_kcal_100g: 100,
        proteins_100g: 3,
        carbohydrates_100g: 8,
        fat_100g: 4,
      },
      images: {
        front: "cached-front.jpg",
        ingredients: "provider-ingredients.jpg",
      },
    });
  });

  it("marks legacy or un-enriched cache documents for one enrichment pass", () => {
    assert.equal(
      needsCacheEnrichment({ code: BARCODE, product_name: "Legacy" }),
      true,
    );
    assert.equal(
      needsCacheEnrichment({
        code: BARCODE,
        product_name: "Current",
        _cache_meta: currentMeta(),
      }),
      false,
    );
  });

  it("refreshes an incomplete cache and returns the merged product immediately", async () => {
    let apiCalls = 0;
    let stored: Record<string, unknown> | undefined;

    const cached = {
      code: BARCODE,
      product_name: "Cached name",
      images: { front: "cached-front.jpg" },
    };

    const service = new ProductLookupService(
      {
        findByCode: async () => cached,
        upsertFromLiveApi: async (_barcode, product) => {
          stored = product;
        },
        recordRefreshAttempt: async () => {},
        isAvailable: async () => true,
        close: async () => {},
      },
      {
        fetchProduct: async () => {
          apiCalls += 1;
          return {
            status: "found",
            product: {
              product_name: "Provider name",
              quantity: "500 ml",
              images: {
                front: "provider-front.jpg",
                ingredients: "provider-ingredients.jpg",
              },
              nutriments: {
                proteins_100g: 3,
              },
            },
          };
        },
        isCircuitOpen: () => false,
      },
    );

    const result = await service.lookup(BARCODE);

    assert.equal(apiCalls, 1);
    assert.equal(result.outcome, "hit");
    assert.equal(result.source, "cache");
    assert.deepEqual(result.product, {
      code: BARCODE,
      product_name: "Cached name",
      quantity: "500 ml",
      images: {
        front: "cached-front.jpg",
        ingredients: "provider-ingredients.jpg",
      },
      nutriments: {
        proteins_100g: 3,
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(stored, result.product);
  });

  it("returns the previous cache unchanged when the API fails", async () => {
    let apiCalls = 0;
    const outcomes: string[] = [];
    const cached = {
      code: BARCODE,
      product_name: "Old but usable",
    };

    const service = new ProductLookupService(
      {
        findByCode: async () => cached,
        upsertFromLiveApi: async () => {
          throw new Error("must not overwrite old cache on failure");
        },
        recordRefreshAttempt: async (_barcode, outcome) => {
          outcomes.push(outcome);
        },
        isAvailable: async () => true,
        close: async () => {},
      },
      {
        fetchProduct: async () => {
          apiCalls += 1;
          return { status: "error", reason: "timeout", retryable: true };
        },
        isCircuitOpen: () => false,
      },
    );

    const result = await service.lookup(BARCODE);

    assert.equal(apiCalls, 1);
    assert.deepEqual(result, {
      outcome: "hit",
      source: "cache",
      product: cached,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(outcomes, ["error"]);
  });

  it("keeps the previous cache when OFF confirms 404", async () => {
    let apiCalls = 0;
    let recorded: string | undefined;

    const cached = {
      code: BARCODE,
      product_name: "Previously known",
    };

    const service = new ProductLookupService(
      {
        findByCode: async () => cached,
        upsertFromLiveApi: async () => {
          throw new Error("404 refresh must not overwrite cache");
        },
        recordRefreshAttempt: async (_barcode, outcome) => {
          recorded = outcome;
        },
        isAvailable: async () => true,
        close: async () => {},
      },
      {
        fetchProduct: async () => {
          apiCalls += 1;
          return { status: "not_found" };
        },
        isCircuitOpen: () => false,
      },
    );

    const result = await service.lookup(BARCODE);

    assert.equal(apiCalls, 1);
    assert.deepEqual(result, {
      outcome: "hit",
      source: "cache",
      product: cached,
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(recorded, "not_found");
  });

  it("does not retry during the refresh cooldown after a previous failed attempt", async () => {
    let apiCalls = 0;
    const cached = {
      code: BARCODE,
      product_name: "Old",
      _cache_meta: currentMeta({
        enrichmentVersion: 0,
        lastRefreshAttemptAt: new Date().toISOString(),
      }),
    };

    const service = new ProductLookupService(
      {
        findByCode: async () => cached,
        upsertFromLiveApi: async () => {},
        recordRefreshAttempt: async () => {},
        isAvailable: async () => true,
        close: async () => {},
      },
      {
        fetchProduct: async () => {
          apiCalls += 1;
          return { status: "found", product: { quantity: "1 kg" } };
        },
        isCircuitOpen: () => false,
      },
    );

    const result = await service.lookup(BARCODE);

    assert.equal(apiCalls, 0);
    assert.deepEqual(result, {
      outcome: "hit",
      source: "cache",
      product: cached,
    });
  });

  it("coalesces concurrent refreshes for the same barcode", async () => {
    let apiCalls = 0;
    let releaseApi!: () => void;

    const apiReady = new Promise<void>((resolve) => {
      releaseApi = resolve;
    });

    const cached = {
      code: BARCODE,
      product_name: "Old",
    };

    const service = new ProductLookupService(
      {
        findByCode: async () => cached,
        upsertFromLiveApi: async () => {},
        recordRefreshAttempt: async () => {},
        isAvailable: async () => true,
        close: async () => {},
      },
      {
        fetchProduct: async () => {
          apiCalls += 1;
          await apiReady;
          return {
            status: "found",
            product: { quantity: "1 kg" },
          };
        },
        isCircuitOpen: () => false,
      },
    );

    const first = service.lookup(BARCODE);
    const second = service.lookup(BARCODE);

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(apiCalls, 1);

    releaseApi();
    const [a, b] = await Promise.all([first, second]);

    assert.deepEqual(a, b);
    assert.equal(a.outcome, "hit");
    assert.equal(a.product.quantity, "1 kg");
  });
});
