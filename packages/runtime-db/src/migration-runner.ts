import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createContextAwarePool } from "./postgres-client.js";

export interface MigrationRunnerOptions {
  readonly serviceName: string;
  readonly migrationsDir?: string;
  readonly moduleUrl?: string | URL;
  readonly connectionString?: string;
}

function resolveMigrationsDir(options: MigrationRunnerOptions): string {
  if (options.migrationsDir) return options.migrationsDir;
  if (options.moduleUrl) {
    return fileURLToPath(new URL("../migrations/", options.moduleUrl));
  }
  return join(process.cwd(), "migrations");
}

export async function runMigrations(options: MigrationRunnerOptions): Promise<void> {
  const migrationsDir = resolveMigrationsDir(options);
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

    if (files.length === 0) {
      throw new Error(
        `No migration files found for service "${options.serviceName}" in ${migrationsDir}`,
      );
    }

    for (const file of files) {
      const version = file.replace(/\\.sql$/, "");
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1))",
          [`gestione-dispensa-migration:${version}`],
        );

        // Inventory historically stored the ".sql" suffix. Accept that legacy
        // ledger representation so already-applied production migrations are
        // never replayed when moving to the canonical version representation.
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
