import assert from "node:assert/strict";
import test from "node:test";
import { beginShoppingAction, resolveShoppingResult } from "./shopping-journey.js";

test("shopping mutations carry the list version and action", () => {
  const result = beginShoppingAction("COMPLETE", 7);
  assert.equal(result.state, "SUBMITTING");
  assert.equal(result.listVersion, 7);
  assert.equal(result.action, "COMPLETE");
});

test("shopping version conflicts remain explicit", () => {
  const result = resolveShoppingResult(beginShoppingAction("EDIT", 1), "CONFLICT");
  assert.equal(result.state, "CONFLICT");
  assert.match(result.message, /changed elsewhere/);
});

test("offline shopping mutations expose a retry path", () => {
  const result = resolveShoppingResult(beginShoppingAction("SNOOZE", 2), "OFFLINE");
  assert.equal(result.state, "OFFLINE");
  assert.match(result.message, /retry/);
});
