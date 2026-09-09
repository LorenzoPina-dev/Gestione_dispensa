import assert from "node:assert/strict";
import { test } from "node:test";
import { ResilientSearch, SearchProjection } from "../dist/index.js";

const event = (eventId, familyId, id, version, text) => ({
  eventId,
  familyId,
  occurredAt: "2026-09-09T00:00:00.000Z",
  document: {
    id,
    familyId,
    type: "INVENTORY",
    text,
    updatedAt: "2026-09-09T00:00:00.000Z",
    sourceVersion: version,
  },
});

test("projection rebuild is deterministic and family isolated", () => {
  const projection = new SearchProjection();
  const events = [
    event("b", "family-1", "item-2", 1, "Tomato"),
    event("a", "family-1", "item-1", 1, "Pasta"),
  ];

  projection.rebuild(events);

  assert.deepEqual(
    projection.search("family-1", "pasta").map((result) => result.document.id),
    ["item-1"],
  );
  assert.deepEqual(projection.search("family-2", "pasta"), []);
  assert.equal(projection.projectionLag(Date.parse("2026-09-09T00:01:00.000Z")), 60_000);
});

test("newer source versions replace stale documents and replay is idempotent", () => {
  const projection = new SearchProjection();
  const first = event("a", "family-1", "item-1", 1, "Old");
  const newer = event("b", "family-1", "item-1", 2, "New");

  projection.rebuild([newer, first, newer]);

  assert.equal(projection.search("family-1", "new")[0].document.sourceVersion, 2);
  assert.deepEqual(projection.search("family-1", "old"), []);
});

test("authoritative fallback remains available when projection is degraded", async () => {
  const projection = new SearchProjection();
  const fallback = [{ document: event("a", "family-1", "item-1", 1, "Pasta").document, score: 1 }];
  const search = new ResilientSearch(projection, {
    search: async (familyId) => (familyId === "family-1" ? fallback : []),
  });

  search.setProjectionAvailable(false);
  assert.deepEqual(await search.search("family-1", "pasta"), fallback);
  assert.deepEqual(await search.search("family-2", "pasta"), []);
});
