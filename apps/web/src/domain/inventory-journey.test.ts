import assert from "node:assert/strict";
import test from "node:test";
import { beginInventoryAction, resolveInventoryResult } from "./inventory-journey.js";

test("inventory actions carry the optimistic version into submission", () => {
  const result = beginInventoryAction("CONSUMPTION", 4);
  assert.equal(result.state, "SUBMITTING");
  assert.equal(result.version, 4);
});

test("inventory conflicts are explicit and recoverable", () => {
  const result = resolveInventoryResult(beginInventoryAction("RECEIPT", 2), "CONFLICT");
  assert.equal(result.state, "CONFLICT");
  assert.match(result.message, /changed elsewhere/);
});

test("invalid versions do not submit mutations", () => {
  assert.equal(beginInventoryAction("WASTE", -1).state, "RETRYABLE_ERROR");
});
