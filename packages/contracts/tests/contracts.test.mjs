import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateEventEnvelope } from "../src/index.ts";

const eventDirectory = new URL("../events/", import.meta.url);

test("all event schema files are valid JSON documents", async () => {
  const files = (await readdir(eventDirectory)).filter((file) => file.endsWith(".json"));

  assert.ok(files.length >= 10);
  await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(new URL(file, eventDirectory), "utf8"))),
  );
});

test("event envelope validator requires household scope and payload", () => {
  const invalid = validateEventEnvelope({ eventType: "inventory.stock.received" });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.path === "$.householdId"));

  const valid = validateEventEnvelope({
    eventId: "event-1",
    eventType: "inventory.stock.received",
    eventVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    aggregateType: "stock_item",
    aggregateId: "stock-1",
    householdId: "family-1",
    actorType: "SYSTEM",
    traceId: "0123456789abcdef",
    schemaRef: "events/inventory.stock.received.v1.json",
    payload: { stockItemId: "stock-1" },
  });
  assert.deepEqual(valid, { valid: true, issues: [] });
});
