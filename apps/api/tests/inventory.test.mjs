import assert from "node:assert/strict";
import { test } from "node:test";
import { SequenceIdGenerator } from "../../../packages/testkit/src/index.ts";
import {
  InventoryService,
  InventoryValidationError,
  movementDelta,
} from "../src/inventory/service.ts";

const stock = {
  id: "stock-1",
  familyId: "family-1",
  productId: "product-1",
  quantity: 10,
  unit: "piece",
  reorderPoint: 2,
  version: 1,
  status: "ACTIVE",
};
const createStock = (overrides = {}) => ({
  familyId: "family-1",
  productId: "product-1",
  quantity: 10,
  unit: "piece",
  actorId: "user-1",
  traceId: "0123456789abcdef",
  ...overrides,
});
const movement = (overrides = {}) => ({
  familyId: "family-1",
  stockItemId: "stock-1",
  kind: "CONSUMPTION",
  quantity: 2,
  unit: "piece",
  source: "MANUAL",
  clientOperationId: "operation-1",
  actorId: "user-1",
  occurredAt: new Date("2026-01-01"),
  traceId: "0123456789abcdef",
  ...overrides,
});

test("inventory creates stock through the repository ownership boundary", async () => {
  const service = new InventoryService(
    {
      async createStockItemAtomic(input) {
        return { ...stock, id: input.id };
      },
      async recordMovementAtomic() {
        throw new Error("not used");
      },
    },
    new SequenceIdGenerator(["stock-1"]),
  );
  assert.equal((await service.createStockItem(createStock())).id, "stock-1");
});

test("inventory validates positive quantities before persistence", async () => {
  let writes = 0;
  const service = new InventoryService(
    {
      async createStockItemAtomic() {
        writes += 1;
        return stock;
      },
      async recordMovementAtomic() {
        throw new Error("not used");
      },
    },
    new SequenceIdGenerator(["stock-1"]),
  );
  await assert.rejects(
    () => service.createStockItem(createStock({ quantity: 0 })),
    InventoryValidationError,
  );
  assert.equal(writes, 0);
});

test("movement deltas preserve immutable ledger semantics and idempotent repository result", async () => {
  let calls = 0;
  const service = new InventoryService(
    {
      async createStockItemAtomic() {
        return stock;
      },
      async recordMovementAtomic() {
        calls += 1;
        return { stockItem: stock, movementId: "movement-1", duplicate: calls > 1 };
      },
    },
    new SequenceIdGenerator(["stock-1"]),
  );
  assert.equal(movementDelta("RECEIPT", 3), 3);
  assert.equal(movementDelta("CONSUMPTION", 3), -3);
  assert.equal(movementDelta("WASTE", 3), -3);
  assert.equal((await service.recordMovement(movement())).duplicate, false);
  assert.equal((await service.recordMovement(movement())).duplicate, true);
});
