import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const migrationsDir = join(process.cwd(), "migrations");

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version varchar(255) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const file of files) {
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1",
      [file],
    );

    if (alreadyApplied.rowCount) {
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(join(migrationsDir, file), "utf8"));
      await client.query(
        "INSERT INTO schema_migrations(version, applied_at) VALUES ($1, now()) ON CONFLICT (version) DO NOTHING",
        [file],
      );
      await client.query("COMMIT");
      console.log(JSON.stringify({ service: "inventory", migration: file, status: "ok" }));
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(JSON.stringify({
        service: "inventory",
        migration: file,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    } finally {
      client.release();
    }
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      service: "inventory",
      event: "migration.failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
