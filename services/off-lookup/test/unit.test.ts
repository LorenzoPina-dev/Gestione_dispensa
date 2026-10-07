import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProductLookupService, isValidBarcode } from "../src/product-lookup-service.js";

describe("off-lookup domain", () => {
  it("accepts only 6..14 numeric barcode input", () => {
    for (const value of ["123456", "8001234567890", "12345678901234"]) {
      assert.equal(isValidBarcode(value), true);
    }
    for (const value of ["", "12345", "123456789012345", "12-34", "abcdef"]) {
      assert.equal(isValidBarcode(value), false);
    }
  });

  it("uses local cache before external API", async () => {
    let apiCalls = 0;
    const service = new ProductLookupService(
      {
        findByCode: async () => ({ name: "Latte", _cache_meta: { schemaVersion: 2, enrichmentVersion: 1 } }),
        upsertFromLiveApi: async () => {},
        recordRefreshAttempt: async () => {},
      },
      {
        fetchProduct: async () => {
          apiCalls += 1;
          return { status: "not_found" };
        },
        isCircuitOpen: () => false,
      },
    );
    const result = await service.lookup("8001234567890");
    assert.equal(result.outcome, "hit");
    assert.equal(result.source, "cache");
    assert.equal(apiCalls, 0);
  });

  it("falls back to live API on cache miss and asynchronously heals cache", async () => {
    let stored: Record<string, unknown> | undefined;
    const service = new ProductLookupService(
      {
        findByCode: async () => undefined,
        upsertFromLiveApi: async (_code, product) => {
          stored = product;
        },
      },
      {
        fetchProduct: async () => ({ status: "found", product: { product_name: "Latte" } }),
        isCircuitOpen: () => false,
      },
    );
    const result = await service.lookup("8001234567890");
    assert.equal(result.source, "live-api");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(stored, { product_name: "Latte" });
  });

  it("distinguishes definitive not-found from unavailable infrastructure", async () => {
    const make = (response: { status: "not_found" } | { status: "error"; reason: string; retryable: boolean }) =>
      new ProductLookupService(
        { findByCode: async () => undefined, upsertFromLiveApi: async () => {} },
        { fetchProduct: async () => response, isCircuitOpen: () => false },
      );

    assert.equal((await make({ status: "not_found" }).lookup("8001234567890")).outcome, "not_found");
    assert.equal(
      (await make({ status: "error", reason: "timeout", retryable: true }).lookup("8001234567890")).outcome,
      "unavailable",
    );
  });

  it("searches products through the ranked external search boundary", async () => {
    let calls = 0;
    const service = new ProductLookupService(
      { findByCode: async () => undefined, upsertFromLiveApi: async () => {}, recordRefreshAttempt: async () => {} },
      {
        fetchProduct: async () => ({ status: "not_found" }),
        searchProducts: async (query, limit) => {
          calls += 1;
          assert.equal(query, "golia");
          assert.equal(limit, 8);
          return {
            status: "found",
            hits: [{ code: "8001234567890", product: { product_name_it: "Golia Caramella", brands: "Perfetti" } }],
          };
        },
        isCircuitOpen: () => false,
      },
    );

    assert.deepEqual(await service.search("go", 8), { status: "found", hits: [] });
    const first = await service.search("  golia  ", 8);
    const second = await service.search("golia", 8);
    assert.equal(first.hits.length, 1);
    assert.equal(second.hits.length, 1);
    assert.equal(calls, 1);
  });

  it("never lets cache write failure change a live hit", async () => {
    const result = await new ProductLookupService(
      {
        findByCode: async () => undefined,
        upsertFromLiveApi: async () => {
          throw new Error("db down");
        },
      },
      {
        fetchProduct: async () => ({ status: "found", product: { name: "Latte" } }),
        isCircuitOpen: () => false,
      },
    ).lookup("8001234567890");
    assert.equal(result.outcome, "hit");
  });

  it("uses OpenSearch locally and does not call external search on a local hit", async () => {
    let localCalls = 0;
    let externalCalls = 0;
    const service = new ProductLookupService(
      { findByCode: async () => undefined, upsertFromLiveApi: async () => {}, recordRefreshAttempt: async () => {} },
      {
        fetchProduct: async () => ({ status: "not_found" }),
        searchProducts: async () => {
          externalCalls += 1;
          return { status: "found", hits: [] };
        },
        isCircuitOpen: () => false,
      },
      {
        search: async (query, limit) => {
          localCalls += 1;
          assert.equal(query, "golia");
          assert.equal(limit, 8);
          return { status: "found", hits: [{ code: "8001234567890", product: { product_name_it: "Golia Caramella" } }] };
        },
      },
    );

    const result = await service.search(" golia ", 8);
    assert.equal(result.source, "local");
    assert.equal(result.hits.length, 1);
    assert.equal(localCalls, 1);
    assert.equal(externalCalls, 0);
  });

  it("falls back to external search when OpenSearch has no local match", async () => {
    let externalCalls = 0;
    const service = new ProductLookupService(
      { findByCode: async () => undefined, upsertFromLiveApi: async () => {}, recordRefreshAttempt: async () => {} },
      {
        fetchProduct: async () => ({ status: "not_found" }),
        searchProducts: async () => {
          externalCalls += 1;
          return { status: "found", hits: [{ code: "8001234567890", product: { product_name: "Prodotto remoto" } }] };
        },
        isCircuitOpen: () => false,
      },
      { search: async () => ({ status: "found", hits: [] }) },
    );

    const result = await service.search("prodotto", 8);
    assert.equal(result.source, "external");
    assert.equal(result.hits.length, 1);
    assert.equal(externalCalls, 1);
  });

  it("indexes products learned from the barcode API without blocking the hit", async () => {
    let indexed: { code: string; product: Record<string, unknown> } | undefined;
    const service = new ProductLookupService(
      { findByCode: async () => undefined, upsertFromLiveApi: async () => {}, recordRefreshAttempt: async () => {} },
      {
        fetchProduct: async () => ({ status: "found", product: { product_name: "Latte" } }),
        isCircuitOpen: () => false,
      },
      undefined,
      {
        upsert: async (code, product) => {
          indexed = { code, product };
        },
      },
    );

    const result = await service.lookup("8001234567890");
    assert.equal(result.outcome, "hit");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(indexed?.code, "8001234567890");
  });

  it("falls back to OFF API when OpenSearch is unavailable", async () => {
    let externalCalls = 0;
    const service = new ProductLookupService(
      { findByCode: async () => undefined, upsertFromLiveApi: async () => {}, recordRefreshAttempt: async () => {} },
      {
        fetchProduct: async () => ({ status: "not_found" }),
        searchProducts: async () => {
          externalCalls += 1;
          return { status: "found", hits: [{ code: "8001234567890", product: { product_name: "Prodotto remoto" } }] };
        },
        isCircuitOpen: () => false,
      },
      { search: async () => { throw new Error("opensearch down"); } },
    );

    const result = await service.search("prodotto", 8);
    assert.equal(result.source, "external");
    assert.equal(result.hits.length, 1);
    assert.equal(externalCalls, 1);
  });

  it("warms Mongo and OpenSearch after an external text-search hit", async () => {
    let stored: Record<string, unknown> | undefined;
    let indexed = 0;
    const service = new ProductLookupService(
      { findByCode: async () => undefined, upsertFromLiveApi: async (_code, product) => { stored = product; }, recordRefreshAttempt: async () => {} },
      {
        fetchProduct: async () => ({ status: "not_found" }),
        searchProducts: async () => ({ status: "found", hits: [{ code: "8001234567890", product: { product_name: "Prodotto remoto" } }] }),
        isCircuitOpen: () => false,
      },
      { search: async () => ({ status: "found", hits: [] }) },
      { upsert: async () => { indexed += 1; } },
    );

    const result = await service.search("prodotto", 8);
    assert.equal(result.source, "external");
    assert.equal(result.hits.length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(stored, { product_name: "Prodotto remoto" });
    assert.equal(indexed, 1);
  });
});
