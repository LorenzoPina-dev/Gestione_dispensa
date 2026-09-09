import assert from "node:assert/strict";
import { test } from "node:test";
import { FixedClock, SequenceIdGenerator } from "../../../packages/testkit/src/index.ts";
import { FamilyService, FamilyValidationError } from "../src/family/service.ts";

function repository() {
  const calls = [];
  return {
    calls,
    async createFamilyAtomic(input) {
      calls.push(input);
      return input;
    },
  };
}

function command(overrides = {}) {
  return {
    displayName: "  Casa Rossi  ",
    locale: "it-IT",
    timezone: "Europe/Rome",
    unitSystem: "METRIC",
    creatorUserId: "user-1",
    traceId: "0123456789abcdef",
    ...overrides,
  };
}

test("family creation creates owner membership, audit, and outbox event atomically", async () => {
  const repo = repository();
  const service = new FamilyService(
    repo,
    new SequenceIdGenerator(["family-1", "membership-1", "event-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
  );
  const result = await service.createFamily(command());

  assert.equal(repo.calls.length, 1);
  assert.equal(result.family.displayName, "Casa Rossi");
  assert.equal(result.membership.role, "OWNER");
  assert.equal(result.membership.userId, "user-1");
  assert.equal(result.audit.traceId, "0123456789abcdef");
  assert.equal(result.event.eventType, "family.created");
  assert.equal(result.event.payload.creatorMembershipId, "membership-1");
});

test("family creation rejects invalid commands before persistence", async () => {
  const repo = repository();
  const service = new FamilyService(
    repo,
    new SequenceIdGenerator(["id"]),
    new FixedClock("2026-01-01T00:00:00Z"),
  );

  await assert.rejects(
    () =>
      service.createFamily(command({ displayName: "", locale: "bad locale", traceId: "short" })),
    FamilyValidationError,
  );
  assert.equal(repo.calls.length, 0);
});

test("family creation trims names and preserves deterministic timestamps", async () => {
  const repo = repository();
  const service = new FamilyService(
    repo,
    new SequenceIdGenerator(["family-1", "membership-1", "event-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
  );
  const result = await service.createFamily(command({ timezone: "UTC" }));

  assert.equal(result.family.displayName, "Casa Rossi");
  assert.equal(result.family.createdAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(result.family.createdAt, result.family.updatedAt);
});
