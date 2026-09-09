import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresShoppingRepository } from "../dist/shopping/postgres.js";

function database() {
  const calls = [];
  return {
    calls,
    async transaction() {
      return {
        async query(text, values = []) {
          calls.push({ text, values });
          if (text.includes("INSERT INTO shopping_items"))
            return {
              rows: [
                {
                  id: "item-1",
                  list_id: "list-1",
                  product_id: "product-1",
                  display_name: "Pasta",
                  quantity: "2",
                  unit: "pack",
                  package_id: null,
                  state: "SUGGESTED",
                  source_type: "REORDER",
                  source_ref: "stock-1",
                  version: 1,
                },
              ],
            };
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

test("shopping list creation is family-scoped and starts at version one", async () => {
  const db = database();
  const list = await new PostgresShoppingRepository(db).createListAtomic({
    id: "list-1",
    familyId: "family-1",
    ownerUserId: "user-1",
    name: "Spesa",
    traceId: "0123456789abcdef",
  });
  assert.equal(list.version, 1);
  assert.match(db.calls[0].text, /family_id/);
});

test("shopping item insertion records source provenance in the same transaction", async () => {
  const db = database();
  const result = await new PostgresShoppingRepository(db).addItemAtomic({
    id: "item-1",
    familyId: "family-1",
    listId: "list-1",
    productId: "product-1",
    displayName: "Pasta",
    quantity: 2,
    unit: "pack",
    sourceType: "REORDER",
    sourceRef: "stock-1",
    traceId: "0123456789abcdef",
  });
  assert.equal(result.merged, false);
  assert.equal(result.item.quantity, 2);
  assert.equal(db.calls.at(-1).text, "COMMIT");
});

test("active semantic duplicates merge quantity instead of creating a second item", async () => {
  const db = database();
  const original = db.transaction;
  db.transaction = async () => ({
    async query(text, values = []) {
      db.calls.push({ text, values });
      if (text.includes("FROM shopping_items"))
        return {
          rows: [
            {
              id: "item-existing",
              list_id: "list-1",
              product_id: "product-1",
              display_name: "Pasta",
              quantity: "2",
              unit: "pack",
              package_id: null,
              state: "SUGGESTED",
              source_type: "MANUAL",
              source_ref: null,
              version: 1,
            },
          ],
        };
      return { rows: [] };
    },
    async commit() {
      db.calls.push({ text: "COMMIT", values: [] });
    },
    async rollback() {
      db.calls.push({ text: "ROLLBACK", values: [] });
    },
  });
  const result = await new PostgresShoppingRepository(db).addItemAtomic({
    id: "item-2",
    familyId: "family-1",
    listId: "list-1",
    productId: "product-1",
    displayName: "Pasta",
    quantity: 3,
    unit: "pack",
    sourceType: "REORDER",
    traceId: "0123456789abcdef",
  });
  db.transaction = original;
  assert.equal(result.merged, true);
  assert.equal(result.item.quantity, 5);
  assert.equal(
    db.calls.filter((call) => call.text.includes("INSERT INTO shopping_items")).length,
    0,
  );
});
