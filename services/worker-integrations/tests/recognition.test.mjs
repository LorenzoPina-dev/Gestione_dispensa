import assert from "node:assert/strict";
import { test } from "node:test";
import { RecognitionPipeline } from "../dist/recognition.js";

const upload = { filename: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 100 };
const candidate = { name: "Pasta", confidence: 0.8, source: "synthetic-ocr" };

function pipeline(overrides = {}) {
  return new RecognitionPipeline({
    scanner: { scan: async () => "CLEAN" },
    provider: {
      recognize: async () => ({ providerRequestId: "request-1", candidates: [candidate] }),
    },
    maxUploadBytes: 1_000,
    timeoutMs: 100,
    lowConfidenceThreshold: 0.7,
    ...overrides,
  });
}

test("recognition returns reviewable candidates without mutating the catalog", async () => {
  const result = await pipeline().process(upload, "trace-1234567890123456");

  assert.equal(result.state, "PENDING_REVIEW");
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.candidates, [candidate]);
});

test("unsupported, oversized, and malware uploads remain safely manual", async () => {
  assert.equal(
    (await pipeline().process({ ...upload, mimeType: "application/pdf" }, "trace-1234567890123456"))
      .reason,
    "UNSUPPORTED_MEDIA",
  );
  assert.equal(
    (await pipeline().process({ ...upload, sizeBytes: 2_000 }, "trace-1234567890123456")).reason,
    "UPLOAD_TOO_LARGE",
  );
  assert.equal(
    (
      await pipeline({
        scanner: { scan: async () => "MALWARE" },
      }).process(upload, "trace-1234567890123456")
    ).reason,
    "MALWARE",
  );
});

test("scanner and provider outages degrade without accepting a mutation", async () => {
  const scanUnavailable = await pipeline({
    scanner: { scan: async () => "UNAVAILABLE" },
  }).process(upload, "trace-1234567890123456");
  assert.deepEqual(scanUnavailable, {
    state: "DEGRADED",
    reason: "SCAN_UNAVAILABLE",
    reviewRequired: true,
  });

  const timeout = await pipeline({
    timeoutMs: 5,
    provider: {
      recognize: async () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ providerRequestId: "late", candidates: [candidate] }), 25),
        ),
    },
  }).process(upload, "trace-1234567890123456");
  assert.deepEqual(timeout, {
    state: "DEGRADED",
    reason: "PROVIDER_TIMEOUT",
    reviewRequired: true,
  });
});

test("low-confidence candidates remain pending review", async () => {
  const result = await pipeline({
    provider: {
      recognize: async () => ({
        providerRequestId: "request-low-confidence",
        candidates: [{ ...candidate, confidence: 0.2 }],
      }),
    },
  }).process(upload, "trace-1234567890123456");

  assert.equal(result.state, "PENDING_REVIEW");
  assert.equal(result.reviewRequired, true);
  assert.equal(result.candidates?.[0].confidence, 0.2);
});
