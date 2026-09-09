import assert from "node:assert/strict";
import { test } from "node:test";
import { OfferProviderError, OffersAdapter } from "../dist/offers.js";

const offer = {
  offerId: "offer-1",
  productId: "product-1",
  retailerId: "retailer-1",
  area: "IT-MI",
  price: 2.5,
  currency: "EUR",
  validFrom: "2026-09-01T00:00:00.000Z",
  validTo: "2026-10-01T00:00:00.000Z",
  sourceQuality: "IMPORTED",
};

test("offers adapter imports active authorized-area offers with provenance", async () => {
  const adapter = new OffersAdapter({
    now: () => Date.parse("2026-09-09T00:00:00.000Z"),
    timeoutMs: 100,
    provider: {
      fetch: async () => ({ provider: "synthetic-retailer", sourceVersion: "v1", offers: [offer] }),
    },
  });

  const result = await adapter.import("IT-MI", "trace-1234567890123456");

  assert.equal(result.state, "IMPORTED");
  assert.equal(result.offers[0].provider, "synthetic-retailer");
  assert.equal(result.offers[0].sourceVersion, "v1");
});

test("stale, invalid, and wrong-area offers are never returned as active", async () => {
  const adapter = new OffersAdapter({
    now: () => Date.parse("2026-09-09T00:00:00.000Z"),
    timeoutMs: 100,
    provider: {
      fetch: async () => ({
        provider: "synthetic-retailer",
        sourceVersion: "v1",
        offers: [
          { ...offer, validTo: "2026-09-08T00:00:00.000Z" },
          { ...offer, area: "IT-ROMA" },
          { ...offer, price: -1 },
        ],
      }),
    },
  });

  assert.deepEqual(await adapter.import("IT-MI", "trace-1234567890123456"), {
    state: "STALE",
    offers: [],
  });
});

test("provider rate limits degrade without blocking core shopping", async () => {
  const adapter = new OffersAdapter({
    timeoutMs: 100,
    provider: {
      fetch: async () => {
        throw new OfferProviderError("PROVIDER_RATE_LIMITED", "retry later");
      },
    },
  });

  assert.deepEqual(await adapter.import("IT-MI", "trace-1234567890123456"), {
    state: "DEGRADED",
    offers: [],
    reason: "PROVIDER_RATE_LIMITED",
  });
});
