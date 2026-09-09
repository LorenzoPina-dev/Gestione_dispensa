import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresInventoryRepository } from "../dist/inventory/postgres.js";

function transactionClient() {
  const calls = [];
  return {
    calls,
    async transaction() {
      return {
        async query(text, values = []) {
          calls.push({ text, values });
          if (text.includes("UPDATE stock_items")) {
            return {
              rows: [
                {
                  id: "stock-1",
                  family_id: "family-1",
                  product_id: "product-1",
                  current_quantity: "8",
                  unit: "piece",
                  reorder_point: "2",
                  version: 2,
                  status: "ACTIVE",
                },
              ],
            };
          }
          if (text.includes("FOR UPDATE"))
            return {
              rows: [
                {
                  id: "stock-1",
                  family_id: "family-1",
                  product_id: "product-1",
                  current_quantity: "10",
                  unit: "piece",
                  reorder_point: "2",
                  version: 1,
                  status: "ACTIVE",
                },
              ],
            };
          if (text.includes("INSERT INTO stock_movements")) return { rows: [{ id: "movement-1" }] };
          return { rows: [] };
        },
        async commit() {
          calls.push({ text: "COMMIT", values: [] });
        },
        async rollback() {
          calls.push({ text: "ROLLBACK", values: [] });
        },
      };
    },
  };
}

const movement = {
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
};

test("stock creation persists family-scoped item and returns version one", async () => {
  const database = transactionClient();
  const repository = new PostgresInventoryRepository(database);
  const item = await repository.createStockItemAtomic({
    id: "stock-1",
    familyId: "family-1",
    productId: "product-1",
    quantity: 10,
    unit: "piece",
    actorId: "user-1",
    traceId: "0123456789abcdef",
  });
  assert.equal(item.version, 1);
  assert.match(database.calls[0].text, /family_id/);
  assert.equal(database.calls.at(-1).text, "COMMIT");
});

test("movement locks the stock, updates quantity and appends immutable movement", async () => {
  const database = transactionClient();
  const repository = new PostgresInventoryRepository(database);
  const result = await repository.recordMovementAtomic(movement);
  assert.equal(result.stockItem.quantity, 8);
  assert.equal(result.stockItem.version, 2);
  assert.equal(result.movementId, "movement-1");
  assert.equal(result.duplicate, false);
  assert.ok(database.calls.some((call) => call.text.includes("FOR UPDATE")));
  assert.equal(database.calls.at(-1).text, "COMMIT");
});

test("duplicate client operation is acknowledged without applying a second side effect", async () => {
  const database = transactionClient();
  const original = database.transaction;
  database.transaction = async () => ({
    async query(text, values = []) {
      database.calls.push({ text, values });
      if (text.includes("FROM stock_movements")) {
        return {
          rows: [
            {
              movement_id: "movement-existing",
              stock_item: {
                id: "stock-1",
                family_id: "family-1",
                product_id: "product-1",
                current_quantity: "8",
                unit: "piece",
                reorder_point: "2",
                version: 2,
                status: "ACTIVE",
              },
            },
          ],
        };
      }
      return { rows: [] };
    },
    async commit() {
      database.calls.push({ text: "COMMIT", values: [] });
    },
    async rollback() {
      database.calls.push({ text: "ROLLBACK", values: [] });
    },
  });
  const result = await new PostgresInventoryRepository(database).recordMovementAtomic(movement);
  database.transaction = original;
  assert.equal(result.duplicate, true);
  assert.equal(result.movementId, "movement-existing");
  assert.equal(database.calls.filter((call) => call.text.includes("INSERT INTO")).length, 0);
});
