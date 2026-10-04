import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProductLookupService } from "../src/product-lookup-service.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function service(options: {
  stored: Record<string, unknown> | undefined;
  failMongo?: boolean;
  indexed: Array<{ code: string; product: Record<string, unknown> }>;
}) {
  return new ProductLookupService(
    {
      findByCode: async (code) => (options.stored === undefined ? undefined : { code, ...options.stored }),
      upsertFromLiveApi: async () => {
        if (options.failMongo) throw new Error("mongo down");
      },
      recordRefreshAttempt: async () => {},
      isAvailable: async () => true,
      close: async () => {},
    },
    {
      fetchProduct: async () => ({ status: "not_found" }),
      searchProducts: async () => ({
        status: "found",
        hits: [{ code: "8001234567890", product: { product_name: "Golia", completeness: 0.99 } }],
      }),
      isCircuitOpen: () => false,
    },
    { search: async () => ({ status: "found", hits: [] }) },
    { upsert: async (code, product) => { options.indexed.push({ code, product }); } },
  );
}

describe("external search hits are indexed from the stored Mongo document", () => {
  it("keeps the images Mongo already has instead of indexing the poorer live payload", async () => {
    const indexed: Array<{ code: string; product: Record<string, unknown> }> = [];
    const s = service({
      indexed,
      stored: {
        product_name: "Golia",
        completeness: 0.99,
        images: { front_it: { rev: "4", sizes: { "200": { w: 200, h: 200 } } } },
      },
    });

    await s.search("golia", 8);
    await flush();

    assert.equal(indexed.length, 1);
    assert.deepEqual(
      (indexed[0]?.product.images as Record<string, unknown>).front_it,
      { rev: "4", sizes: { "200": { w: 200, h: 200 } } },
    );
  });

  it("falls back to the live payload when Mongo has no document", async () => {
    const indexed: Array<{ code: string; product: Record<string, unknown> }> = [];
    await service({ indexed, stored: undefined }).search("golia", 8);
    await flush();

    assert.equal(indexed.length, 1);
    assert.deepEqual(indexed[0]?.product, { product_name: "Golia", completeness: 0.99 });
  });

  it("still indexes when the Mongo write fails", async () => {
    const indexed: Array<{ code: string; product: Record<string, unknown> }> = [];
    await service({ indexed, stored: undefined, failMongo: true }).search("golia", 8);
    await flush();

    assert.equal(indexed.length, 1);
  });
});
