import assert from "node:assert/strict";
import { test } from "node:test";
import { CachingBarcodeProvider } from "../dist/providers/caching-barcode-provider.js";

const context = { traceId: "trace-1234567890123456", signal: new AbortController().signal };

const cachedResponse = {
  provider: "openfoodfacts",
  providerRequestId: "8001234567890",
  sourceVersion: "off-api-v2",
  observedAt: "2026-09-01T00:00:00.000Z",
  quality: "IMPORTED",
  confidence: 0.85,
  product: { canonicalName: "Pasta (bulk import)", defaultUnit: "pack" },
  warnings: [],
};

const liveResponse = {
  provider: "openfoodfacts",
  providerRequestId: "8009999999999",
  sourceVersion: "off-api-v2",
  observedAt: "2026-09-24T00:00:00.000Z",
  quality: "IMPORTED",
  confidence: 0.85,
  product: { canonicalName: "Live lookup product", defaultUnit: "pack" },
  warnings: [],
};

function silentLog() {}

function fakeCache(initial = new Map()) {
  const store = initial;
  return {
    calls: { get: 0, set: 0 },
    async get(identifier) {
      this.calls.get += 1;
      const entry = store.get(identifier);
      return entry;
    },
    async set(entry) {
      this.calls.set += 1;
      store.set(entry.identifier, entry);
    },
    async isAvailable() {
      return true;
    },
    async close() {},
    store,
  };
}

test("cache hit returns the cached response without calling the inner provider", async () => {
  const cache = fakeCache(
    new Map([
      [
        "8001234567890",
        { identifier: "8001234567890", response: cachedResponse, cachedAt: "2026-09-01T00:00:00.000Z", origin: "bulk-import" },
      ],
    ]),
  );
  let innerCalls = 0;
  const inner = {
    lookup: async () => {
      innerCalls += 1;
      throw new Error("inner provider must not be called on a cache hit");
    },
  };
  const provider = new CachingBarcodeProvider({ inner, cache, log: silentLog });

  const result = await provider.lookup("8001234567890", context);

  assert.deepEqual(result, cachedResponse);
  assert.equal(innerCalls, 0);
  assert.equal(cache.calls.get, 1);
});

test("cache miss falls through to the inner provider and backfills the cache", async () => {
  const cache = fakeCache();
  const inner = { lookup: async () => liveResponse };
  const provider = new CachingBarcodeProvider({ inner, cache, log: silentLog });

  const result = await provider.lookup("8009999999999", context);
  assert.deepEqual(result, liveResponse);

  // set() is fire-and-forget; give the microtask queue a turn to flush it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cache.calls.set, 1);
  const stored = cache.store.get("8009999999999");
  assert.equal(stored.origin, "live");
  assert.deepEqual(stored.response, liveResponse);
});

test("a broken cache never breaks the lookup: get and set failures both degrade to the live API", async () => {
  const cache = {
    async get() {
      throw new Error("mongo unreachable");
    },
    async set() {
      throw new Error("mongo unreachable");
    },
    async isAvailable() {
      return false;
    },
    async close() {},
  };
  const inner = { lookup: async () => liveResponse };
  const provider = new CachingBarcodeProvider({ inner, cache, log: silentLog });

  const result = await provider.lookup("8009999999999", context);
  assert.deepEqual(result, liveResponse);
});

test("not-found responses (no product) are cached too, avoiding repeat API calls for known-absent barcodes", async () => {
  const cache = fakeCache();
  const notFound = { ...liveResponse, product: undefined, quality: "UNKNOWN", confidence: 0 };
  const inner = { lookup: async () => notFound };
  const provider = new CachingBarcodeProvider({ inner, cache, log: silentLog });

  await provider.lookup("8000000000000", context);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const stored = cache.store.get("8000000000000");
  assert.deepEqual(stored.response, notFound);
});
