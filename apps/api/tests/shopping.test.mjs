import assert from "node:assert/strict";
import { test } from "node:test";
import { SequenceIdGenerator } from "../../../packages/testkit/src/index.ts";
import { ShoppingService, ShoppingValidationError } from "../src/shopping/service.ts";

const list = {
  id: "list-1",
  familyId: "family-1",
  ownerUserId: "user-1",
  name: "Spesa",
  status: "ACTIVE",
  version: 1,
};
const item = {
  id: "item-1",
  listId: "list-1",
  productId: "product-1",
  displayName: "Pasta",
  quantity: 2,
  unit: "pack",
  packageId: undefined,
  state: "SUGGESTED",
  sourceType: "REORDER",
  sourceRef: "stock-1",
  version: 1,
};
const itemCommand = (overrides = {}) => ({
  familyId: "family-1",
  listId: "list-1",
  productId: "product-1",
  displayName: " Pasta ",
  quantity: 2,
  unit: "pack",
  sourceType: "REORDER",
  sourceRef: "stock-1",
  traceId: "0123456789abcdef",
  ...overrides,
});

test("shopping creates a family list and delegates semantic dedupe atomically", async () => {
  const service = new ShoppingService(
    {
      async createListAtomic(input) {
        return { ...list, id: input.id, name: input.name };
      },
      async addItemAtomic(input) {
        return { item: { ...item, id: input.id, displayName: input.displayName }, merged: true };
      },
    },
    new SequenceIdGenerator(["list-1", "item-1"]),
  );
  const created = await service.createList({
    familyId: "family-1",
    ownerUserId: "user-1",
    name: " Spesa ",
    traceId: "0123456789abcdef",
  });
  const added = await service.addItem(itemCommand());

  assert.equal(created.name, "Spesa");
  assert.equal(added.merged, true);
  assert.equal(added.item.displayName, "Pasta");
});

test("shopping validates commands before repository writes", async () => {
  let writes = 0;
  const service = new ShoppingService(
    {
      async createListAtomic() {
        writes += 1;
        return list;
      },
      async addItemAtomic() {
        writes += 1;
        return { item, merged: false };
      },
    },
    new SequenceIdGenerator(["id"]),
  );

  await assert.rejects(
    () => service.addItem(itemCommand({ quantity: 0 })),
    ShoppingValidationError,
  );
  assert.equal(writes, 0);
});
