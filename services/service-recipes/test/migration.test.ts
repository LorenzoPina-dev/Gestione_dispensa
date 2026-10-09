import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";

const databaseUrl = process.env.RECIPES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("RECIPES_TEST_DATABASE_URL is required for real PostgreSQL migration tests.");

const pool = new Pool({ connectionString: databaseUrl });
const execFileAsync = promisify(execFile);

async function migrate() {
  return execFileAsync("node", ["dist/migrate.js"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

describe("service-recipes / real migration schema", () => {
  before(async () => {
    await pool.query("SELECT 1");
    await migrate();
    await migrate();
  });

  after(async () => {
    await pool.end();
  });

  it("records 001_initial once", async () => {
    const result = await pool.query("SELECT version,count(*) OVER(PARTITION BY version) AS occurrences FROM schema_migrations");
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].version, "001_initial");
    assert.equal(Number(result.rows[0].occurrences), 1);
  });

  it("contains recipe, ingredient, step, idempotency and outbox tables", async () => {
    const result = await pool.query(
      "SELECT table_schema,table_name,column_name FROM information_schema.columns " +
      "WHERE table_schema='recipes_domain' AND table_name IN ('recipes','recipe_ingredients','recipe_steps','idempotency_keys','outbox_events')",
    );
    const actual = new Set(result.rows.map((r) => r.table_schema + "." + r.table_name + "." + r.column_name));
    for (const required of [
      "recipes_domain.recipes.id",
      "recipes_domain.recipes.owner_user_id",
      "recipes_domain.recipes.family_id",
      "recipes_domain.recipes.title",
      "recipes_domain.recipes.servings",
      "recipes_domain.recipes.version",
      "recipes_domain.recipe_ingredients.recipe_id",
      "recipes_domain.recipe_ingredients.product_id",
      "recipes_domain.recipe_ingredients.quantity",
      "recipes_domain.recipe_steps.position",
      "recipes_domain.recipe_steps.instruction",
      "recipes_domain.idempotency_keys.request_hash",
      "recipes_domain.idempotency_keys.response_body",
      "recipes_domain.outbox_events.event_type",
      "recipes_domain.outbox_events.payload",
    ]) assert.equal(actual.has(required), true, "missing schema element: " + required);
  });
});
