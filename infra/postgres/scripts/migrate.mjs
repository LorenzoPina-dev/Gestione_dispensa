import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIGRATION_PATTERN = /^(\d{4})_([a-z0-9-]+)\.sql$/;
const LOCK_KEY = "gestione_dispensa_migrations_v1";

export async function discoverMigrations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = MIGRATION_PATTERN.exec(entry.name);
    if (match === null) {
      continue;
    }
    const sql = await readFile(join(directory, entry.name), "utf8");
    migrations.push({
      version: match[1],
      name: match[2],
      filename: entry.name,
      sql,
      checksum: checksum(sql),
    });
  }

  migrations.sort((left, right) => left.version.localeCompare(right.version));
  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }
  return migrations;
}

export function checksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function planMigrations(migrations, appliedRows) {
  const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));
  for (const migration of migrations) {
    const appliedChecksum = applied.get(migration.version);
    if (appliedChecksum !== undefined && appliedChecksum !== migration.checksum) {
      throw new Error(`Checksum drift detected for migration ${migration.version}.`);
    }
  }
  return migrations.filter((migration) => !applied.has(migration.version));
}

export function migrationTransactionSql(migration) {
  const version = escapeLiteral(migration.version);
  const name = escapeLiteral(migration.name);
  const digest = escapeLiteral(migration.checksum);
  return [
    "BEGIN;",
    "SET LOCAL lock_timeout = '5s';",
    migration.sql.trimEnd(),
    "",
    `INSERT INTO schema_migrations (version, name, checksum) VALUES (${version}, ${name}, ${digest});`,
    "COMMIT;",
  ].join("\n");
}

/**
 * Builds the argv passed to the `psql` binary for a single query. Kept as a
 * pure function (no process spawning) so its shape can be unit-tested
 * directly, independent of whether a `psql` binary is installed.
 *
 * IMPORTANT: `--no-align` mode defaults psql's field separator to '|', not a
 * tab, while parseRows() below splits result lines on "\t". Without the
 * explicit --field-separator flag, every multi-column row silently fails to
 * parse the moment this executor is pointed at a real database. This was
 * only caught by running the script against a live PostgreSQL 16 instance;
 * the pre-existing tests could not detect it because they always supplied
 * pre-shaped fake stdout instead of exercising psql's actual output format.
 */
export function buildPsqlQueryArgs(databaseUrl, sql) {
  return [
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--field-separator",
    "\t",
    "--dbname",
    databaseUrl,
    "--command",
    sql,
  ];
}

export function createPsqlExecutor({ databaseUrl, psql = "psql" }) {
  if (!databaseUrl) {
    throw new Error("A database URL is required.");
  }
  return {
    query(sql) {
      return runProcess(psql, buildPsqlQueryArgs(databaseUrl, sql));
    },
  };
}

export async function migrate({ directory, executor }) {
  const migrations = await discoverMigrations(directory);
  await ensureMigrationTable(executor);
  await executor.query(`SELECT pg_advisory_lock(hashtext('${LOCK_KEY}'));`);
  try {
    const rawRows = await executor.query(
      "SELECT version, checksum FROM schema_migrations ORDER BY version;",
    );
    const appliedRows = parseRows(rawRows.stdout);
    const pending = planMigrations(migrations, appliedRows);
    for (const migration of pending) {
      await executor.query(migrationTransactionSql(migration));
    }
    return { applied: pending.map((migration) => migration.version), pending: pending.length };
  } finally {
    await executor.query(`SELECT pg_advisory_unlock(hashtext('${LOCK_KEY}'));`);
  }
}

export async function status({ directory, executor }) {
  const migrations = await discoverMigrations(directory);
  await ensureMigrationTable(executor);
  const rawRows = await executor.query(
    "SELECT version, checksum FROM schema_migrations ORDER BY version;",
  );
  const appliedRows = parseRows(rawRows.stdout);
  planMigrations(migrations, appliedRows);
  const applied = new Set(appliedRows.map((row) => row.version));
  return migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    state: applied.has(migration.version) ? "applied" : "pending",
  }));
}

async function ensureMigrationTable(executor) {
  await executor.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, name text NOT NULL DEFAULT 'bootstrap', checksum text NOT NULL DEFAULT 'bootstrap', applied_at timestamptz NOT NULL DEFAULT now());",
  );
  await executor.query(
    "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'bootstrap';",
  );
  await executor.query(
    "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text NOT NULL DEFAULT 'bootstrap';",
  );
}

function parseRows(stdout) {
  return stdout.trim() === ""
    ? []
    : stdout
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          const [version, migrationChecksum] = line.split("\t");
          if (!version || !migrationChecksum) {
            throw new Error("Invalid migration status output.");
          }
          return { version, checksum: migrationChecksum };
        });
}

function escapeLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runProcess(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        rejectPromise(new Error(`psql exited with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

async function main() {
  const command = process.argv[2] ?? "migrate";
  const directory = resolve(
    process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "migrations"),
  );
  const executor = createPsqlExecutor({ databaseUrl: process.env.DATABASE_URL });
  const result =
    command === "status"
      ? await status({ directory, executor })
      : await migrate({ directory, executor });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
