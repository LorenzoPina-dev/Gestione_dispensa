import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const databaseUrl = process.env.CATALOG_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "CATALOG_TEST_DATABASE_URL is required. Catalog migration tests use the real PostgreSQL database.",
  );
}

const pool = new Pool({ connectionString: databaseUrl });
const execFileAsync = promisify(execFile);

async function tables(): Promise<Set<string>> {
  const result = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
  );
  return new Set(result.rows.map((row) => row.table_name as string));
}

async function columnSet(table: string): Promise<Set<string>> {
  const result = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
    [table],
  );
  return new Set(result.rows.map((row) => row.column_name as string));
}

describe("service-catalog / real migration schema", () => {
  before(async () => {
    await pool.query("SELECT 1");
    await execFileAsync("node", ["dist/migrate.js"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    await execFileAsync("node", ["dist/migrate.js"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });

  after(async () => {
    await pool.end();
  });

  it("records all numbered migrations exactly once", async () => {
    const files = (await readdir("migrations"))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .map((file) => file.replace(/\.sql$/, ""))
      .sort();

    const result = await pool.query(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const applied = result.rows.map((row) => row.version as string);

    for (const file of files) {
      assert.equal(applied.includes(file), true, `migration not recorded: ${file}`);
    }
    assert.equal(new Set(applied).size, applied.length);
  });

  it("contains the complete Catalog owner schema", async () => {
    const actualTables = await tables();
    for (const table of [
      "schema_migrations",
      "brands",
      "data_sources",
      "products",
      "product_identifiers",
      "data_provenance",
      "outbox_events",
      "idempotency_keys",
    ]) {
      assert.equal(actualTables.has(table), true, `missing catalog table: ${table}`);
    }

    for (const column of [
      "id",
      "canonical_name",
      "brand_id",
      "default_unit",
      "status",
      "provenance_quality",
      "version",
      "category",
      "calories_per_100",
      "protein_per_100",
      "carbs_per_100",
      "fat_per_100",
      "fiber_per_100",
      "quantity_value",
      "quantity_unit",
      "quantity_label",
      "serving_size",
      "serving_quantity",
      "images_json",
      "product_details_snapshot",
      "external_source",
      "external_ref",
      "created_at",
      "updated_at",
    ]) {
      assert.equal((await columnSet("products")).has(column), true, `missing products column: ${column}`);
    }

    for (const column of ["product_id", "source_id", "identifier_type", "normalized_value", "is_verified"]) {
      assert.equal(
        (await columnSet("product_identifiers")).has(column),
        true,
        `missing product_identifiers column: ${column}`,
      );
    }
  });

  it("enforces globally unique barcode identifiers at the database boundary", async () => {
    const indexes = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='product_identifiers'",
    );
    assert.equal(
      indexes.rows.some((row) => String(row.indexname) === "ux_product_identifiers_identifier"),
      true,
    );
  });
});
