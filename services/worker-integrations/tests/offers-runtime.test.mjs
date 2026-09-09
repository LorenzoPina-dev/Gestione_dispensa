import assert from "node:assert/strict";
import { test } from "node:test";
import { OfferProviderError, OffersAdapter } from "../dist/offers.js";
import { OffersRuntimeService } from "../dist/offers-runtime.js";

test("offers runtime persists authorized area imports by source window", async () => {
  const imports = new Map();
  const service = new OffersRuntimeService(
    new OffersAdapter({
      timeoutMs: 100,
      now: () => Date.parse("2026-09-09T00:00:00Z"),
      provider: {
        async fetch() {
          return {
            provider: "retailer-1",
            sourceVersion: "license-v1",
            offers: [
              {
                offerId: "offer-1",
                productId: "product-1",
                retailerId: "retailer-1",
                area: "IT-MI",
                price: 2,
                currency: "EUR",
                validFrom: "2026-09-01T00:00:00Z",
                validTo: "2026-10-01T00:00:00Z",
                sourceQuality: "IMPORTED",
              },
            ],
          };
        },
      },
    }),
    {
      async getImport(key) {
        return imports.get(key);
      },
      async saveImport(key, result) {
        imports.set(key, result);
      },
    },
  );
  const first = await service.import({
    windowKey: "retailer-1:IT-MI:2026-09-09",
    area: "IT-MI",
    traceId: "trace-offers-0001",
  });
  const second = await service.import({
    windowKey: "retailer-1:IT-MI:2026-09-09",
    area: "IT-MI",
    traceId: "trace-offers-0001",
  });
  assert.equal(first.state, "IMPORTED");
  assert.equal(second, first);
  assert.equal(imports.size, 1);
});

test("offers runtime persists degraded provider state without fabricating offers", async () => {
  const imports = new Map();
  const service = new OffersRuntimeService(
    new OffersAdapter({
      timeoutMs: 100,
      provider: {
        async fetch() {
          throw new OfferProviderError("PROVIDER_RATE_LIMITED", "provider unavailable");
        },
      },
    }),
    {
      async getImport(key) {
        return imports.get(key);
      },
      async saveImport(key, result) {
        imports.set(key, result);
      },
    },
  );
  const result = await service.import({
    windowKey: "window-2",
    area: "IT-MI",
    traceId: "trace-offers-0002",
  });
  assert.equal(result.state, "DEGRADED");
  assert.equal(result.offers.length, 0);
});
