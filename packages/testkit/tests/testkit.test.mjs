import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FixedClock,
  InMemoryHttpClient,
  SequenceIdGenerator,
  createFixtureFactory,
  createTestContext,
} from "../src/index.ts";

test("FixedClock returns copies and advances deterministically", () => {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const first = clock.now();

  first.setUTCDate(15);
  clock.advanceBy(60_000);

  assert.equal(clock.now().toISOString(), "2026-01-01T00:01:00.000Z");
});

test("FixedClock rejects invalid input", () => {
  assert.throws(() => new FixedClock("invalid"), /valid initial time/);
  assert.throws(() => new FixedClock(0).advanceBy(Number.NaN), /finite/);
});

test("SequenceIdGenerator cycles through deterministic values", () => {
  const ids = new SequenceIdGenerator(["id-1", "id-2"]);

  assert.deepEqual([ids.next(), ids.next(), ids.next()], ["id-1", "id-2", "id-1"]);
  assert.throws(() => new SequenceIdGenerator([]), /at least one/);
});

test("createTestContext composes deterministic dependencies", () => {
  const context = createTestContext("2026-01-01T00:00:00.000Z", ["family-1"]);

  assert.equal(context.clock.now().toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(context.ids.next(), "family-1");
});

test("fixture factory applies shallow overrides without mutating defaults", () => {
  const factory = createFixtureFactory({ status: "ACTIVE", count: 1 });
  const fixture = factory.create({ count: 2 });

  assert.deepEqual(fixture, { status: "ACTIVE", count: 2 });
  assert.deepEqual(factory.create(), { status: "ACTIVE", count: 1 });
});

test("in-memory HTTP client preserves request and response boundaries", async () => {
  const client = new InMemoryHttpClient((request) => ({
    status: request.method === "GET" && request.path === "/health" ? 200 : 404,
    headers: { "x-test": "true" },
    body: request.body,
  }));

  const response = await client.request({ method: "GET", path: "/health" });

  assert.equal(response.status, 200);
  assert.equal(response.headers["x-test"], "true");
});
