import assert from "node:assert/strict";
import { test } from "node:test";
import { SequenceIdGenerator } from "../../../packages/testkit/src/index.ts";
import { InventoryController, InventoryHttpError } from "../dist/inventory/controller.js";
import { InventoryService } from "../dist/inventory/service.js";

const principal = {
  subject: "user-1",
  issuer: "issuer",
  audience: ["api"],
  expiresAt: new Date("2030-01-01"),
  issuedAt: new Date("2026-01-01"),
  roles: [],
  scopes: [],
};
const meta = { requestId: "request-1", traceId: "0123456789abcdef", schemaVersion: "1.0" };
const membership = { familyId: "family-1", userId: "user-1", role: "MEMBER", status: "ACTIVE" };

function controller() {
  const inventory = new InventoryService(
    {
      async createStockItemAtomic(input) {
        return {
          id: input.id,
          familyId: input.familyId,
          productId: input.productId,
          quantity: input.quantity,
          unit: input.unit,
          version: 1,
          status: "ACTIVE",
        };
      },
      async recordMovementAtomic(input) {
        return {
          stockItem: {
            id: input.stockItemId,
            familyId: input.familyId,
            productId: "product-1",
            quantity: 8,
            unit: input.unit,
            version: 2,
            status: "ACTIVE",
          },
          movementId: "movement-1",
          duplicate: false,
        };
      },
    },
    new SequenceIdGenerator(["stock-1"]),
  );
  return new InventoryController(
    inventory,
    {
      async getMembership() {
        return membership;
      },
    },
    {
      async getStockItem() {
        return { familyId: "family-1", version: 1 };
      },
    },
  );
}

test("inventory controller enforces membership and returns stock creation envelope", async () => {
  const result = await controller().createStockItem(
    principal,
    {
      familyId: "family-1",
      productId: "product-1",
      quantity: 3,
      unit: "piece",
      traceId: meta.traceId,
    },
    meta,
  );
  assert.equal(result.data.id, "stock-1");
});

test("inventory controller rejects stale If-Match versions", async () => {
  await assert.rejects(
    () =>
      controller().recordMovement(
        principal,
        {
          familyId: "family-1",
          stockItemId: "stock-1",
          kind: "CONSUMPTION",
          quantity: 1,
          unit: "piece",
          source: "MANUAL",
          clientOperationId: "operation-1",
          occurredAt: new Date("2026-01-01"),
          traceId: meta.traceId,
        },
        '"2"',
        meta,
      ),
    (error) =>
      error instanceof InventoryHttpError &&
      error.code === "VERSION_CONFLICT" &&
      error.status === 409,
  );
});

test("inventory controller rejects unauthenticated mutations", async () => {
  await assert.rejects(
    () =>
      controller().createStockItem(
        undefined,
        {
          familyId: "family-1",
          productId: "product-1",
          quantity: 3,
          unit: "piece",
          traceId: meta.traceId,
        },
        meta,
      ),
    (error) => error instanceof InventoryHttpError && error.status === 401,
  );
});
