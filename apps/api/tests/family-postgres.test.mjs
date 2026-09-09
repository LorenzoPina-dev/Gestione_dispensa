import assert from "node:assert/strict";
import { test } from "node:test";
import { PostgresFamilyRepository, PostgresInviteRepository } from "../src/family/postgres.ts";

class FakeTransaction {
  constructor(rows = []) {
    this.rows = rows;
    this.queries = [];
    this.committed = false;
    this.rolledBack = false;
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    return { rows: this.rows.shift() ?? [] };
  }

  async commit() {
    this.committed = true;
  }

  async rollback() {
    this.rolledBack = true;
  }
}

class FakeDatabase {
  constructor(...transactions) {
    this.transactions = [...transactions];
  }

  async transaction() {
    const transaction = this.transactions.shift();
    if (!transaction) throw new Error("No transaction fixture available.");
    return transaction;
  }
}

const family = {
  id: "00000000-0000-0000-0000-000000000001",
  displayName: "Casa",
  creatorUserId: "00000000-0000-0000-0000-000000000002",
  locale: "it-IT",
  timezone: "Europe/Rome",
  unitSystem: "METRIC",
  status: "ACTIVE",
  version: 1,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

test("family PostgreSQL repository commits family, membership, audit and outbox together", async () => {
  const transaction = new FakeTransaction();
  const repository = new PostgresFamilyRepository(new FakeDatabase(transaction));
  const input = {
    family,
    membership: {
      id: "00000000-0000-0000-0000-000000000003",
      familyId: family.id,
      userId: family.creatorUserId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: family.createdAt,
      version: 1,
    },
    audit: {
      familyId: family.id,
      actorId: family.creatorUserId,
      action: "family.created",
      resourceType: "family",
      resourceId: family.id,
      outcome: "SUCCESS",
      traceId: "0123456789abcdef",
    },
    event: {
      eventId: "00000000-0000-0000-0000-000000000004",
      eventType: "family.created",
      eventVersion: 1,
      aggregateType: "family",
      aggregateId: family.id,
      familyId: family.id,
      actorId: family.creatorUserId,
      traceId: "0123456789abcdef",
      payload: {
        familyId: family.id,
        creatorMembershipId: "00000000-0000-0000-0000-000000000003",
        locale: "it-IT",
        timezone: "Europe/Rome",
      },
    },
  };

  const result = await repository.createFamilyAtomic(input);
  assert.equal(result, input);
  assert.equal(transaction.queries.length, 4);
  assert.equal(transaction.committed, true);
  assert.equal(transaction.rolledBack, false);
  assert.match(transaction.queries[3].text, /outbox_events/);
});

test("invite repository maps hash-only records and performs acceptance in a transaction", async () => {
  const read = new FakeTransaction([
    [
      {
        id: "invite-1",
        family_id: family.id,
        created_by: family.creatorUserId,
        role: "MEMBER",
        token_hash: "aa",
        fallback_code_hash: "bb",
        status: "CREATED",
        expires_at: "2026-01-02T00:00:00.000Z",
        consumed_at: null,
        revoked_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]);
  const acceptance = new FakeTransaction([
    [
      {
        id: "attempt-1",
        invite_id: "invite-1",
        user_id: null,
        browser_binding_hash: "cc",
        state: "PENDING_AUTHENTICATION",
        expires_at: "2026-01-01T01:00:00.000Z",
        completed_at: null,
        trace_id: "0123456789abcdef",
      },
    ],
    [],
    [],
    [],
  ]);
  const repository = new PostgresInviteRepository(new FakeDatabase(read, acceptance));
  const invite = await repository.findByTokenHash("aa");
  assert.equal(invite?.tokenHash, "aa");
  assert.equal(invite?.fallbackCodeHash, "bb");

  const attempt = await repository.acceptAtomically({
    attemptId: "attempt-1",
    userId: "user-2",
    now: new Date("2026-01-01T00:30:00.000Z"),
    consentVersion: "consent-v1",
  });
  assert.equal(attempt.state, "ACCEPTED");
  assert.equal(attempt.userId, "user-2");
  assert.equal(acceptance.queries.length, 4);
  assert.equal(acceptance.committed, true);
});
