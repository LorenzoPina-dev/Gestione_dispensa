import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const base = process.env.FAMILY_TEST_URL ?? "http://127.0.0.1:3311";
const databaseUrl = process.env.FAMILY_TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "FAMILY_TEST_DATABASE_URL is required for service-family integration tests. " +
    "These tests intentionally use a real PostgreSQL database and do not mock persistence.",
  );
}

const pool = new Pool({ connectionString: databaseUrl });
const ownerUserId = randomUUID();
const secondUserId = randomUUID();
const familyName = `integration-family-${Date.now()}-${randomUUID().slice(0, 8)}`;
let familyId: string | undefined;
let familyVersion = 1;
let inviteToken: string | undefined;
let inviteId: string | undefined;
let inviteVersion = 1;
let joinAttemptId: string | undefined;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) as Record<string, any> : undefined,
  };
}

function authHeaders(userId = ownerUserId): Record<string, string> {
  return { "x-user-id": userId };
}

describe("service-family / real PostgreSQL integration", () => {
  before(async () => {
    const health = await request("/health/ready");
    assert.equal(health.response.status, 200, "service-family must be running against the integration database");
  });

  after(async () => {
    if (familyId) {
      await pool.query("DELETE FROM families WHERE id=$1", [familyId]);
    }
    await pool.end();
  });

  it("creates a family atomically with the owner membership", async () => {
    const { response, body } = await request("/api/v1/families", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `create-${randomUUID()}`,
      },
      body: JSON.stringify({ name: familyName }),
    });

    assert.equal(response.status, 201);
    assert.equal(body?.data?.name, familyName);
    assert.equal(body?.data?.role, "owner");
    assert.equal(body?.version, 1);
    familyId = body?.data?.familyId;
    assert.match(familyId ?? "", /^[0-9a-f-]{36}$/i);

    const persistedFamily = await pool.query(
      "SELECT id,name,created_by_user_id,version FROM families WHERE id=$1",
      [familyId],
    );
    const membership = await pool.query(
      "SELECT user_id,role,version FROM members WHERE family_id=$1 AND user_id=$2",
      [familyId, ownerUserId],
    );
    const events = await pool.query(
      "SELECT event_type FROM outbox_events WHERE family_id=$1 ORDER BY created_at",
      [familyId],
    );

    assert.equal(persistedFamily.rowCount, 1);
    assert.equal(persistedFamily.rows[0].name, familyName);
    assert.equal(persistedFamily.rows[0].created_by_user_id, ownerUserId);
    assert.equal(Number(persistedFamily.rows[0].version), 1);
    assert.equal(membership.rowCount, 1);
    assert.equal(membership.rows[0].role, "owner");
    assert.deepEqual(events.rows.map((row) => row.event_type), [
      "FamilyCreated",
      "FamilyMemberAdded",
    ]);
    familyVersion = 1;
  });

  it("replays the exact stored response for the same idempotency key", async () => {
    const key = `replay-${randomUUID()}`;
    const first = await request("/api/v1/families", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify({ name: `${familyName}-replay` }),
    });
    assert.equal(first.response.status, 201);

    const second = await request("/api/v1/families", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify({ name: `${familyName}-replay` }),
    });
    assert.equal(second.response.status, first.response.status);
    assert.deepEqual(second.body, first.body);

    await pool.query("DELETE FROM families WHERE id=$1", [first.body?.data?.familyId]);
  });

  it("rejects idempotency-key reuse with a different request body", async () => {
    const key = `conflict-${randomUUID()}`;
    const first = await request("/api/v1/families", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify({ name: `${familyName}-conflict-a` }),
    });
    assert.equal(first.response.status, 201);

    const second = await request("/api/v1/families", {
      method: "POST",
      headers: { ...authHeaders(), "content-type": "application/json", "x-idempotency-key": key },
      body: JSON.stringify({ name: `${familyName}-conflict-b` }),
    });
    assert.equal(second.response.status, 409);
    assert.equal(second.body?.error?.code, "CONFLICT");

    await pool.query("DELETE FROM families WHERE id=$1", [first.body?.data?.familyId]);
  });

  it("lists and reads the persisted family through the service", async () => {
    assert.ok(familyId);
    const list = await request("/api/v1/families", {
      headers: authHeaders(),
    });
    assert.equal(list.response.status, 200);
    assert.ok(list.body?.items?.some((item: any) => item.familyId === familyId));

    const detail = await request(`/api/v1/families/${familyId}`, {
      headers: authHeaders(),
    });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body?.data?.familyId, familyId);
    assert.equal(detail.body?.data?.name, familyName);
    assert.equal(detail.body?.data?.members?.some((member: any) => member.userId === ownerUserId), true);
    familyVersion = Number(detail.body?.data?.version);
    assert.equal(familyVersion, 1);
  });

  it("updates with If-Match and rejects a stale version", async () => {
    assert.ok(familyId);
    const key = `patch-${randomUUID()}`;
    const updatedName = `${familyName}-updated`;

    const update = await request(`/api/v1/families/${familyId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": key,
        "if-match": String(familyVersion),
      },
      body: JSON.stringify({ name: updatedName }),
    });

    assert.equal(update.response.status, 200);
    assert.equal(update.body?.data?.name, updatedName);
    assert.equal(Number(update.body?.version), 2);
    familyVersion = 2;

    const stale = await request(`/api/v1/families/${familyId}`, {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `stale-${randomUUID()}`,
        "if-match": "1",
      },
      body: JSON.stringify({ name: `${updatedName}-stale` }),
    });

    assert.equal(stale.response.status, 412);
    assert.equal(stale.body?.error?.code, "PRECONDITION_FAILED");

    const event = await pool.query(
      "SELECT event_type,payload FROM outbox_events WHERE family_id=$1 AND event_type='FamilyUpdated'",
      [familyId],
    );
    assert.equal(event.rowCount, 1);
    assert.equal(event.rows[0].payload.name ?? event.rows[0].payload.data?.name, updatedName);
  });

  it("exposes member state from the real persistence model", async () => {
    assert.ok(familyId);
    const members = await request(`/api/v1/families/${familyId}/members`, {
      headers: authHeaders(),
    });

    assert.equal(members.response.status, 200);
    assert.equal(members.body?.items?.length, 1);
    assert.equal(members.body?.items?.[0]?.userId, ownerUserId);
    assert.equal(members.body?.items?.[0]?.role, "owner");
  });

  it("creates an invite and persists only its hashed secret material", async () => {
    assert.ok(familyId);
    const key = `invite-${randomUUID()}`;
    const created = await request(`/api/v1/families/${familyId}/invites`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": key,
      },
      body: JSON.stringify({
        email: "integration@example.com",
        role: "member",
        expiresInSeconds: 3600,
      }),
    });

    assert.equal(created.response.status, 201);
    inviteId = created.body?.data?.inviteId;
    inviteVersion = Number(created.body?.version);
    inviteToken = created.body?.data?.qrPayload;
    assert.match(inviteId ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(created.body?.data?.role, "member");
    assert.match(inviteToken ?? "", /^[0-9a-f]{64}$/i);

    const db = await pool.query(
      "SELECT token_hash,fallback_code,status FROM invites WHERE id=$1",
      [inviteId],
    );
    assert.equal(db.rowCount, 1);
    assert.notEqual(db.rows[0].token_hash, inviteToken);
    assert.equal(db.rows[0].status, "pending");
  });

  it("resolves an invite through a real join-attempt transaction", async () => {
    assert.ok(inviteToken);
    const resolved = await request("/api/v1/family-invites/resolve", {
      method: "POST",
      headers: {
        ...authHeaders(secondUserId),
        "content-type": "application/json",
        "x-idempotency-key": `resolve-${randomUUID()}`,
      },
      body: JSON.stringify({
        token: inviteToken,
        browserBindingHash: "0123456789abcdef0123456789abcdef",
      }),
    });

    assert.equal(resolved.response.status, 200);
    joinAttemptId = resolved.body?.data?.id;
    assert.equal(resolved.body?.data?.userId, secondUserId);
    assert.equal(resolved.body?.data?.familyId, familyId);
    assert.equal(resolved.body?.data?.state, "PENDING_REVIEW");

    const persisted = await pool.query(
      "SELECT state,user_id,invite_id FROM join_attempts WHERE id=$1",
      [joinAttemptId],
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].state, "PENDING_REVIEW");
    assert.equal(persisted.rows[0].user_id, secondUserId);
  });

  it("accepts the join attempt atomically and consumes the invite", async () => {
    assert.ok(joinAttemptId);
    const accepted = await request(`/api/v1/invites/${joinAttemptId}/accept`, {
      method: "POST",
      headers: {
        ...authHeaders(secondUserId),
        "content-type": "application/json",
        "x-idempotency-key": `accept-${randomUUID()}`,
      },
      body: JSON.stringify({ consentVersion: "privacy-consent-v1" }),
    });

    assert.equal(accepted.response.status, 201);
    assert.equal(accepted.body?.data?.familyId, familyId);
    assert.equal(accepted.body?.data?.userId, secondUserId);
    assert.equal(accepted.body?.data?.role, "member");

    const state = await pool.query(
      "SELECT i.status AS invite_status,j.state AS join_state,m.role AS member_role " +
      "FROM invites i JOIN join_attempts j ON j.invite_id=i.id " +
      "JOIN members m ON m.family_id=i.family_id AND m.user_id=$2 " +
      "WHERE j.id=$1",
      [joinAttemptId, secondUserId],
    );

    assert.equal(state.rowCount, 1);
    assert.equal(state.rows[0].invite_status, "accepted");
    assert.equal(state.rows[0].join_state, "ACCEPTED");
    assert.equal(state.rows[0].member_role, "member");
  });

  it("revokes a pending invite with optimistic locking", async () => {
    assert.ok(familyId);
    const key = `revoke-${randomUUID()}`;
    const created = await request(`/api/v1/families/${familyId}/invites`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        "x-idempotency-key": `create-revoke-${randomUUID()}`,
      },
      body: JSON.stringify({ role: "member", expiresInSeconds: 3600 }),
    });
    assert.equal(created.response.status, 201);
    const id = created.body?.data?.inviteId;
    const version = Number(created.body?.version);

    const revoked = await request(`/api/v1/families/${familyId}/invites/${id}`, {
      method: "DELETE",
      headers: {
        ...authHeaders(),
        "x-idempotency-key": key,
        "if-match": String(version),
      },
    });
    assert.equal(revoked.response.status, 204);

    const db = await pool.query("SELECT status FROM invites WHERE id=$1", [id]);
    assert.equal(db.rows[0]?.status, "revoked");
  });
});
