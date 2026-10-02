import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

const databaseUrl = process.env.FAMILY_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "FAMILY_TEST_DATABASE_URL is required. Migration tests intentionally use the real PostgreSQL schema.",
  );
}

const pool = new Pool({ connectionString: databaseUrl });

async function columns(tableName: string): Promise<Set<string>> {
  const result = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
    [tableName],
  );
  return new Set(result.rows.map((row) => row.column_name as string));
}

describe("service-family / real migration contract", () => {
  before(async () => {
    const ready = await pool.query("SELECT 1");
    assert.equal(ready.rows[0]["?column?"], 1);
  });

  after(async () => {
    await pool.end();
  });

  it("has the migration ledger", async () => {
    const result = await pool.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    assert.ok(result.rowCount >= 1);
    assert.ok(result.rows.some((row) => row.version === "001_initial"));
  });

  it("contains every table required by service-family runtime", async () => {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    const tables = new Set(result.rows.map((row) => row.table_name as string));
    for (const table of [
      "families",
      "members",
      "invites",
      "join_attempts",
      "outbox_events",
      "idempotency_keys",
    ]) {
      assert.equal(tables.has(table), true, `missing runtime table: ${table}`);
    }
  });

  it("contains the member columns used by reads and authorization consumers", async () => {
    const actual = await columns("members");
    for (const column of [
      "id",
      "family_id",
      "user_id",
      "role",
      "status",
      "joined_at",
      "created_at",
      "updated_at",
      "version",
    ]) {
      assert.equal(actual.has(column), true, `missing members column: ${column}`);
    }
  });

  it("contains every invite column used by creation, resolve and acceptance", async () => {
    const actual = await columns("invites");
    for (const column of [
      "id",
      "family_id",
      "email",
      "role",
      "token_hash",
      "fallback_code",
      "status",
      "expires_at",
      "created_by_user_id",
      "accepted_by_user_id",
      "accepted_at",
      "created_at",
      "updated_at",
      "version",
    ]) {
      assert.equal(actual.has(column), true, `missing invites column: ${column}`);
    }
  });

  it("allows every role exposed by the API contract", async () => {
    const result = await pool.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='members'::regclass AND contype='c'",
    );
    const definitions = result.rows.map((row) => String(row.definition));
    assert.ok(
      definitions.some((value) => value.includes("viewer")),
      "members role constraint does not include viewer",
    );
  });

  it("provides the join-attempt fields required by resolve and accept", async () => {
    const actual = await columns("join_attempts");
    for (const column of [
      "id",
      "invite_id",
      "user_id",
      "browser_binding_hash",
      "state",
      "expires_at",
      "updated_at",
      "version",
    ]) {
      assert.equal(actual.has(column), true, `missing join_attempts column: ${column}`);
    }
  });
});
