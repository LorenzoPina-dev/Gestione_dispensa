import assert from "node:assert/strict";
import { test } from "node:test";
import { BarcodeCatalogAdapter, BarcodeProviderError, normalizeBarcode } from "../dist/barcode.js";

const response = {
  provider: "synthetic-catalog",
  providerRequestId: "request-1",
  sourceVersion: "catalog-v1",
  observedAt: "2026-09-09T00:00:00.000Z",
  quality: "IMPORTED",
  confidence: 0.9,
  product: { canonicalName: "Pasta", brand: "Example", defaultUnit: "pack" },
  warnings: [],
};

test("barcode adapter normalizes identifiers and returns reviewable candidates", async () => {
  const adapter = new BarcodeCatalogAdapter({
    timeoutMs: 100,
    provider: { lookup: async () => response },
  });

  const result = await adapter.lookup("EAN13", "800-123-456-7890", "trace-1234567890123456");

  assert.equal(result.state, "CANDIDATE");
  assert.equal(result.candidate?.identifier, "8001234567890");
  assert.equal(result.candidate?.reviewRequired, true);
});

test("barcode adapter preserves manual fallback and provider degradation", async () => {
  const notFound = new BarcodeCatalogAdapter({
    timeoutMs: 100,
    provider: { lookup: async () => ({ ...response, product: undefined }) },
  });
  assert.deepEqual(await notFound.lookup("EAN13", "8001234567890", "trace-1234567890123456"), {
    state: "MANUAL_REQUIRED",
    reason: "NOT_FOUND",
  });

  const limited = new BarcodeCatalogAdapter({
    timeoutMs: 100,
    provider: {
      lookup: async () => {
        throw new BarcodeProviderError("PROVIDER_RATE_LIMITED", "slow down", true);
      },
    },
  });
  assert.deepEqual(await limited.lookup("EAN13", "8001234567890", "trace-1234567890123456"), {
    state: "DEGRADED",
    reason: "PROVIDER_RATE_LIMITED",
  });
});

test("barcode validation rejects malformed values before provider access", () => {
  assert.equal(normalizeBarcode("EAN13", "800-123-456-7890"), "8001234567890");
  assert.throws(() => normalizeBarcode("EAN13", "not-a-barcode"), /supported numeric length/);
});

test("barcode provider timeout degrades without blocking manual catalog entry", async () => {
  const adapter = new BarcodeCatalogAdapter({
    timeoutMs: 5,
    provider: {
      lookup: async () => new Promise((resolve) => setTimeout(() => resolve(response), 25)),
    },
  });

  assert.deepEqual(await adapter.lookup("EAN13", "8001234567890", "trace-1234567890123456"), {
    state: "DEGRADED",
    reason: "PROVIDER_TIMEOUT",
  });
});
