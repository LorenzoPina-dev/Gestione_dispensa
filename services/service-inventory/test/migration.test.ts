import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";

const databaseUrl = process.env.INVENTORY_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "INVENTORY_TEST_DATABASE_URL is required for migration tests. " +
    "The migration suite intentionally executes the real compiled migration against PostgreSQL.",
  );
}

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const pool = new Pool({ connectionString: databaseUrl });

async function runMigration() {
  return execFileAsync("node", ["dist/migrate.js"], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

describe("service-inventory / real migration", () => {
  before(async () => {
    await runMigration();
  });

  after(async () => {
    await pool.end();
  });

  it("records every physical migration exactly once", async () => {
    const rows = await pool.query(
      "SELECT version, count(*) OVER (PARTITION BY version) AS occurrences " +
      "FROM schema_migrations ORDER BY version",
    );
    assert.ok(rows.rowCount >= 1);
    for (const row of rows.rows) assert.equal(Number(row.occurrences), 1);
  });

  it("is idempotent when the migration process is executed again", async () => {
    await runMigration();
    const rows = await pool.query(
      "SELECT version, count(*) OVER (PARTITION BY version) AS occurrences " +
      "FROM schema_migrations ORDER BY version",
    );
    for (const row of rows.rows) assert.equal(Number(row.occurrences), 1);
  });

  it("enforces a unique current-stock identity", async () => {
    const index = await pool.query(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname='public' AND indexname='pantry_items_identity_uq'`,
    );
    assert.equal(index.rowCount, 1);
    assert.match(index.rows[0].indexdef, /UNIQUE/i);
    assert.match(index.rows[0].indexdef, /family_id/);
    assert.match(index.rows[0].indexdef, /product_id/);
    assert.match(index.rows[0].indexdef, /lot_id/);
    assert.match(index.rows[0].indexdef, /lot_code/);

    const legacy = await pool.query(
      `SELECT 1
       FROM pg_indexes
       WHERE schemaname='public' AND indexname='pantry_items_identity_idx'`,
    );
    assert.equal(legacy.rowCount, 0, "legacy identity index must not block distinct inventory batches");
  });

  it("contains the schema required by the running inventory service", async () => {
    const checks = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name IN ('pantry_items','pantry_lots','movements','outbox_events','idempotency_keys')
      ORDER BY table_name, ordinal_position
    `);
    const actual = new Set(checks.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const required of [
      "pantry_items.id",
      "pantry_items.family_id",
      "pantry_items.product_id",
      "pantry_items.quantity",
      "pantry_items.unit",
      "pantry_items.location",
      "pantry_items.expires_at",
      "pantry_items.expiration_source",
      "pantry_items.version",
      "pantry_items.opened_at",
      "pantry_items.remaining_content_quantity",
      "pantry_items.remaining_content_unit",
      "movements.id",
      "movements.pantry_item_id",
      "movements.type",
      "movements.quantity",
      "outbox_events.event_id",
      "outbox_events.event_type",
      "idempotency_keys.key",
      "idempotency_keys.actor_user_id",
      "idempotency_keys.request_hash",
      "idempotency_keys.response_body",
    ]) {
      assert.equal(actual.has(required), true, `missing schema element: ${required}`);
    }
  });
});
