import assert from "node:assert/strict";
import { test } from "node:test";
import { ReorderPolicy, ReorderService } from "../src/shopping/reorder.ts";

const stock = (overrides = {}) => ({
  id: "stock-1",
  familyId: "family-1",
  productId: "product-1",
  quantity: 2,
  unit: "piece",
  reorderPoint: 2,
  version: 4,
  status: "ACTIVE",
  ...overrides,
});

test("reorder policy triggers below and exactly at threshold, but not above", () => {
  const policy = new ReorderPolicy();
  assert.equal(policy.evaluate(stock({ quantity: 1 })).reason, "THRESHOLD_REACHED");
  assert.equal(policy.evaluate(stock({ quantity: 2 })).reorderPoint, 2);
  assert.equal(policy.evaluate(stock({ quantity: 3 })), undefined);
  assert.equal(policy.evaluate(stock({ reorderPoint: undefined })), undefined);
});

test("reorder service deduplicates by stock version and respects ignored/snoozed items", async () => {
  const calls = [];
  const service = new ReorderService({
    async findByDedupeKey(key) {
      return key.endsWith(":4") ? undefined : { dedupeKey: key, state: "IGNORED" };
    },
    async upsertReorderSuggestion(suggestion) {
      calls.push(suggestion);
      return { suggestion, created: calls.length === 1 };
    },
  });
  const first = await service.evaluate(stock());
  const ignored = await service.evaluate(stock({ version: 5 }));

  assert.equal(first.created, true);
  assert.equal(ignored, undefined);
  assert.equal(calls.length, 1);
});

test("reorder event carries stable dedupe key and canonical payload", () => {
  const policy = new ReorderPolicy();
  const suggestion = policy.evaluate(stock());
  const service = new ReorderService({
    async findByDedupeKey() {},
    async upsertReorderSuggestion(value) {
      return { suggestion: value, created: true };
    },
  });
  const event = service.eventFor(suggestion);

  assert.equal(event.eventType, "inventory.reorder-point-reached");
  assert.equal(event.payload.dedupeKey, suggestion.dedupeKey);
  assert.equal(event.payload.availableQuantity, 2);
});
