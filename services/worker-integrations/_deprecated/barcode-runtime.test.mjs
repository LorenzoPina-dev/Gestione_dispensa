import assert from "node:assert/strict";
import { test } from "node:test";
import { BarcodeCatalogAdapter } from "../dist/barcode.js";
import { BarcodeRuntimeService } from "../dist/barcode-runtime.js";

const response = {
  provider: "synthetic-catalog",
  providerRequestId: "request-1",
  sourceVersion: "v1",
  observedAt: "2026-01-01T00:00:00.000Z",
  quality: "IMPORTED",
  confidence: 0.91,
  product: { canonicalName: "Pasta", defaultUnit: "pack" },
  warnings: [],
};

function setup(providerResponse = response) {
  const results = new Map();
  const fallbacks = [];
  const audits = [];
  const service = new BarcodeRuntimeService(
    new BarcodeCatalogAdapter({
      provider: {
        async lookup() {
          return providerResponse;
        },
      },
      timeoutMs: 100,
    }),
    {
      async getResult(jobId) {
        return results.get(jobId);
      },
      async saveResult(result) {
        results.set(result.jobId, result);
      },
      async recordManualFallback(input) {
        fallbacks.push(input);
      },
    },
    {
      async append(input) {
        audits.push(input);
      },
    },
  );
  return { service, results, fallbacks, audits };
}

test("barcode runtime persists reviewable provider provenance and is idempotent", async () => {
  const context = setup();
  const request = {
    jobId: "job-1",
    identifierType: "EAN13",
    value: "1234567890123",
    actorId: "user-1",
    traceId: "trace-barcode-0001",
  };
  const first = await context.service.process(request);
  const second = await context.service.process(request);
  assert.equal(first.provenance.provider, "synthetic-catalog");
  assert.equal(first.candidate.reviewRequired, true);
  assert.equal(second, first);
  assert.equal(context.audits.length, 1);
});

test("barcode runtime records manual fallback on provider degradation", async () => {
  const context = setup({
    ...response,
    product: undefined,
  });
  const result = await context.service.process({
    jobId: "job-2",
    identifierType: "EAN13",
    value: "1234567890123",
    actorId: "user-1",
    traceId: "trace-barcode-0002",
  });
  assert.deepEqual(result, {
    jobId: "job-2",
    state: "MANUAL_REQUIRED",
    reason: "NOT_FOUND",
    provenance: { source: "MANUAL" },
  });
  assert.equal(context.fallbacks[0].reason, "NOT_FOUND");
  assert.equal(context.audits[0].outcome, "DEGRADED");
});
