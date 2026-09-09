import assert from "node:assert/strict";
import test from "node:test";
import { JobError, type JobRecord } from "./job.js";
import {
  movementConsumer,
  projectionRebuildHandler,
  reconciliationHandler,
  reorderConsumer,
} from "./handlers.js";

function job(payload: Readonly<Record<string, unknown>>): JobRecord {
  return {
    id: "job-1",
    capability: "TEST",
    payload,
    idempotencyKey: "key",
    status: "PROCESSING",
    currentAttempt: 1,
    maxAttempts: 3,
    nextAttemptAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

test("movement consumer applies a valid event through an idempotent repository", async () => {
  const events: string[] = [];
  const handler = movementConsumer({
    async applyMovementProjection(event) {
      events.push(event.eventId);
      return { applied: events.length === 1 };
    },
  });
  const result = await handler({
    job: job({
      eventId: "event-1",
      eventType: "inventory.stock.consumed",
      eventVersion: 1,
      aggregateId: "stock-1",
      familyId: "family-1",
      payload: {
        stockItemId: "stock-1",
        productId: "product-1",
        quantity: 2,
        unit: "piece",
        occurredAt: "2026-01-01T00:00:00.000Z",
      },
    }),
    attempt: { id: "attempt-1", jobId: "job-1", attempt: 1, startedAt: 0, status: "PROCESSING" },
  });
  assert.deepEqual(result, { applied: true, eventId: "event-1" });
  assert.deepEqual(events, ["event-1"]);
});

test("invalid movement payloads are permanent failures", async () => {
  const handler = movementConsumer({
    async applyMovementProjection() {
      return { applied: true };
    },
  });
  await assert.rejects(
    () =>
      handler({
        job: job({ eventType: "inventory.stock.consumed" }),
        attempt: { id: "a", jobId: "j", attempt: 1, startedAt: 0, status: "PROCESSING" },
      }),
    (error: unknown) =>
      error instanceof JobError &&
      error.code === "INVALID_MOVEMENT_EVENT" &&
      error.classification === "PERMANENT",
  );
});

test("reorder, reconciliation and projection handlers return auditable results", async () => {
  const reorder = reorderConsumer({
    async applySuggestion() {
      return { applied: true };
    },
  });
  const reorderResult = await reorder({
    job: job({
      eventId: "event-2",
      eventType: "inventory.reorder-point-reached",
      eventVersion: 1,
      aggregateId: "stock-1",
      familyId: "family-1",
      payload: {
        productId: "product-1",
        stockItemId: "stock-1",
        availableQuantity: 1,
        reorderPoint: 2,
        reason: "THRESHOLD_REACHED",
        dedupeKey: "dedupe-1",
      },
    }),
    attempt: { id: "a", jobId: "j", attempt: 1, startedAt: 0, status: "PROCESSING" },
  });
  assert.deepEqual(reorderResult, { applied: true, eventId: "event-2" });

  const reconciliation = reconciliationHandler({
    async findInventoryDrift() {
      return [{ stockItemId: "stock-1", expected: 3, actual: 2 }];
    },
  });
  assert.deepEqual(
    await reconciliation({
      job: job({ familyId: "family-1" }),
      attempt: { id: "a", jobId: "j", attempt: 1, startedAt: 0, status: "PROCESSING" },
    }),
    { checked: 1, drifted: 1, corrections: [] },
  );

  const rebuild = projectionRebuildHandler({
    async rebuildProjection(projection) {
      return { rebuilt: projection === "search" ? 4 : 0 };
    },
  });
  assert.deepEqual(
    await rebuild({
      job: job({ projection: "search" }),
      attempt: { id: "a", jobId: "j", attempt: 1, startedAt: 0, status: "PROCESSING" },
    }),
    { projection: "search", rebuilt: 4 },
  );
});
