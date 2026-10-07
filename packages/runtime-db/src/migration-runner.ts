import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContextAwarePool } from "./postgres-client.js";

export interface MigrationRunnerOptions {
  readonly serviceName: string;
  readonly migrationsDir?: string;
  readonly connectionString?: string;
}

export async function runMigrations(options: MigrationRunnerOptions): Promise<void> {
  const migrationsDir = options.migrationsDir ?? join(process.cwd(), "migrations");
  const pool = createContextAwarePool({
    connectionString:
      options.connectionString ?? process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version varchar(128) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => /^\\d+_.+\\.sql$/.test(file))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const file of files) {
      const version = file.replace(/\\.sql$/, "");
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1))",
          [`gestione-dispensa-migration:${version}`],
        );

        // Check both the canonical version and the legacy filename form.
        // Inventory historically stored the ".sql" suffix; accepting it here
        // prevents already-applied production migrations from running again.
        const applied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1 OR version = $2 LIMIT 1",
          [version, file],
        );

        if (applied.rowCount) {
          await client.query("COMMIT");
          console.log(JSON.stringify({
            service: options.serviceName,
            migration: file,
            status: "skipped",
          }));
          continue;
        }

        await client.query(await readFile(join(migrationsDir, file), "utf8"));
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT (version) DO NOTHING",
          [version],
        );
        await client.query("COMMIT");
        console.log(JSON.stringify({
          service: options.serviceName,
          migration: file,
          status: "applied",
        }));
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(JSON.stringify({
          service: options.serviceName,
          migration: file,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}
