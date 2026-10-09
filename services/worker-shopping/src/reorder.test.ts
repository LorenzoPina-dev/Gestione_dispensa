import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lowStockSuggestionPayload, parseReorderEvent } from "./reorder.js";

describe("shopping reorder event contract", () => {
  it("accepts a low-stock event and extracts reorder quantity", () => {
    const event = parseReorderEvent({
      eventId: "event-1",
      eventType: "PantryLowStock",
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: "service-inventory",
      aggregateId: "product-1",
      familyId: "family-1",
      correlationId: "corr-1",
      payload: { productId: "product-1", reorderPoint: 0, reorderQuantity: 1, unit: "piece" },
    });
    assert.ok(event);
    assert.deepEqual(lowStockSuggestionPayload(event), { productId: "product-1", quantity: 1, unit: "piece", reorderPoint: 0 });
  });

  it("rejects unsupported events", () => {
    assert.equal(parseReorderEvent({ eventId: "1", eventType: "PantryItemAdjusted", schemaVersion: 1, aggregateId: "p", correlationId: "c", producer: "inventory", payload: {} }), null);
  });
});
