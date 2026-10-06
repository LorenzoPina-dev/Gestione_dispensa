import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";

const databaseUrl = process.env.SHOPPING_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("SHOPPING_TEST_DATABASE_URL is required for real PostgreSQL migration tests.");

const pool = new Pool({ connectionString: databaseUrl });
const execFileAsync = promisify(execFile);

async function migrate() {
  return execFileAsync("node", ["dist/migrate.js"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

describe("service-shopping / real migration schema", () => {
  before(async () => {
    await pool.query("SELECT 1");
    await migrate();
    await migrate();
  });

  after(async () => {
    await pool.end();
  });

  it("records all migrations exactly once", async () => {
    const result = await pool.query("SELECT version,count(*) OVER(PARTITION BY version) AS occurrences FROM schema_migrations ORDER BY version");
    assert.deepEqual(result.rows.map((row) => row.version), ["001_initial", "002_reorder_suggestions"]);
    assert.ok(result.rows.every((row) => Number(row.occurrences) === 1));
  });

  it("contains the complete shopping owner schema", async () => {
    const result = await pool.query(
      "SELECT table_schema,table_name,column_name FROM information_schema.columns " +
      "WHERE table_schema='shopping_domain' AND table_name IN ('lists','items','outbox_events','idempotency_keys','reorder_suggestions','processed_events')",
    );
    const actual = new Set(result.rows.map((r) => r.table_schema + "." + r.table_name + "." + r.column_name));
    for (const required of [
      "shopping_domain.lists.id",
      "shopping_domain.lists.family_id",
      "shopping_domain.lists.name",
      "shopping_domain.lists.status",
      "shopping_domain.lists.created_by_user_id",
      "shopping_domain.lists.version",
      "shopping_domain.items.id",
      "shopping_domain.items.list_id",
      "shopping_domain.items.product_id",
      "shopping_domain.items.quantity",
      "shopping_domain.items.unit",
      "shopping_domain.items.checked",
      "shopping_domain.items.version",
      "shopping_domain.outbox_events.event_id",
      "shopping_domain.outbox_events.payload",
      "shopping_domain.idempotency_keys.key",
      "shopping_domain.idempotency_keys.request_hash",
      "shopping_domain.idempotency_keys.response_body",
      "shopping_domain.reorder_suggestions.id",
      "shopping_domain.reorder_suggestions.family_id",
      "shopping_domain.reorder_suggestions.product_id",
      "shopping_domain.reorder_suggestions.quantity",
      "shopping_domain.reorder_suggestions.unit",
      "shopping_domain.reorder_suggestions.reorder_point",
      "shopping_domain.reorder_suggestions.status",
      "shopping_domain.reorder_suggestions.source_event_id",
      "shopping_domain.processed_events.event_id",
      "shopping_domain.processed_events.event_type",
    ]) assert.equal(actual.has(required), true, "missing schema element: " + required);
  });
});
