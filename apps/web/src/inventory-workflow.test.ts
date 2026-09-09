import assert from "node:assert/strict";
import test from "node:test";
import { beginProductInput, getExpiryState, resolveProductInput } from "./inventory-workflow.js";

test("product input keeps barcode, photo and import results reviewable", () => {
  for (const source of ["BARCODE", "PHOTO", "IMPORT"] as const) {
    const result = resolveProductInput(beginProductInput(source), "CANDIDATE");
    assert.equal(result.state, "REVIEW");
    assert.equal(result.retryable, false);
  }
  assert.equal(
    resolveProductInput(beginProductInput("BARCODE"), "MANUAL_REQUIRED").state,
    "MANUAL_REQUIRED",
  );
});

test("inventory recovery states expose explicit retry paths", () => {
  const model = beginProductInput("MANUAL");
  assert.equal(resolveProductInput(model, "OFFLINE").retryable, true);
  assert.equal(resolveProductInput(model, "CONFLICT").state, "CONFLICT");
  assert.equal(resolveProductInput(model, "SUCCESS").retryable, false);
});

test("expiry state distinguishes unknown, fresh, expiring and expired stock", () => {
  assert.equal(getExpiryState(undefined, "2026-09-09T00:00:00Z"), "UNKNOWN");
  assert.equal(getExpiryState("2026-09-20T00:00:00Z", "2026-09-09T00:00:00Z"), "FRESH");
  assert.equal(getExpiryState("2026-09-12T00:00:00Z", "2026-09-09T00:00:00Z"), "EXPIRING");
  assert.equal(getExpiryState("2026-09-08T00:00:00Z", "2026-09-09T00:00:00Z"), "EXPIRED");
  assert.equal(getExpiryState("not-a-date", "2026-09-09T00:00:00Z"), "UNKNOWN");
});
