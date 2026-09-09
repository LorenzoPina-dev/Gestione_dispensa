import assert from "node:assert/strict";
import { test } from "node:test";
import { SearchProjectionRuntime } from "../dist/runtime.js";

function event(id, familyId, version, text) {
  return {
    eventId: id,
    familyId,
    occurredAt: "2026-09-09T00:00:00.000Z",
    document: {
      id: "document-1",
      familyId,
      type: "INVENTORY",
      text,
      updatedAt: "2026-09-09T00:00:00.000Z",
      sourceVersion: version,
    },
  };
}

test("search runtime consumes and rebuilds durable family-scoped projection", async () => {
  const stored = [event("event-1", "family-1", 1, "Pasta")];
  const runtime = new SearchProjectionRuntime(
    {
      async listEvents() {
        return stored;
      },
      async appendEvent(value) {
        stored.push(value);
      },
    },
    {
      async search() {
        return [];
      },
    },
  );
  await runtime.rebuild();
  assert.equal((await runtime.search("family-1", "pasta")).length, 1);
  await runtime.consume(event("event-2", "family-1", 2, "Pasta integrale"));
  assert.equal((await runtime.search("family-1", "integrale")).length, 1);
  assert.equal(runtime.lag(Date.parse("2026-09-09T00:01:00.000Z")), 60_000);
});

test("search runtime uses authoritative fallback when projection is unavailable", async () => {
  const fallback = [{ document: event("event-1", "family-1", 1, "Pasta").document, score: 1 }];
  const runtime = new SearchProjectionRuntime(
    {
      async listEvents() {
        return [];
      },
      async appendEvent() {},
    },
    {
      async search(familyId) {
        return familyId === "family-1" ? fallback : [];
      },
    },
  );
  runtime.setAvailable(false);
  assert.deepEqual(await runtime.search("family-1", "pasta"), fallback);
  assert.deepEqual(await runtime.search("family-2", "pasta"), []);
});
