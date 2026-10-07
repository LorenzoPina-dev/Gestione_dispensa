import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";

const pool = createContextAwarePool({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });
const migrationsDir = join(process.cwd(), "migrations");

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(128) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`gestione-dispensa-migration:${version}`]);
      const applied = await client.query("select 1 from schema_migrations where version=$1", [version]);
      if (applied.rowCount) {
        await client.query("commit");
        console.log(JSON.stringify({ service: "shopping", migration: file, status: "skipped" }));
        continue;
      }
      await client.query(await readFile(join(migrationsDir, file), "utf8"));
      await client.query("insert into schema_migrations(version) values($1) on conflict do nothing", [version]);
      await client.query("commit");
      console.log(JSON.stringify({ service: "shopping", migration: file, status: "applied" }));
    } catch (error) {
      await client.query("rollback");
      console.error(JSON.stringify({ service: "shopping", migration: file, status: "failed", error: String(error) }));
      throw error;
    } finally {
      client.release();
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
