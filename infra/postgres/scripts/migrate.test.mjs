import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checksum,
  discoverMigrations,
  migrate,
  migrationTransactionSql,
  planMigrations,
  status,
} from "./migrate.mjs";

async function withMigrationDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), "dispensa-migrations-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("discoverMigrations sorts versions and computes SHA-256 checksums", async () => {
  await withMigrationDirectory(async (directory) => {
    await writeFile(join(directory, "0002_second.sql"), "SELECT 2;\n");
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");
    await writeFile(join(directory, "README.md"), "ignored");

    const migrations = await discoverMigrations(directory);

    assert.deepEqual(
      migrations.map((migration) => migration.version),
      ["0001", "0002"],
    );
    assert.equal(migrations[0].checksum, checksum("SELECT 1;\n"));
  });
});

test("planMigrations rejects checksum drift and returns only pending migrations", async () => {
  await withMigrationDirectory(async (directory) => {
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");
    const [migration] = await discoverMigrations(directory);

    assert.deepEqual(planMigrations([migration], []), [migration]);
    assert.deepEqual(
      planMigrations([migration], [{ version: "0001", checksum: migration.checksum }]),
      [],
    );
    assert.throws(
      () => planMigrations([migration], [{ version: "0001", checksum: "wrong" }]),
      /Checksum drift/,
    );
  });
});

test("migrationTransactionSql wraps SQL and records checksum", () => {
  const migration = {
    version: "0001",
    name: "first",
    checksum: "abc",
    sql: "CREATE TABLE sample (id int);\n",
  };
  const sql = migrationTransactionSql(migration);

  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /CREATE TABLE sample/);
  assert.match(sql, /INSERT INTO schema_migrations/);
  assert.match(sql, /'abc'/);
  assert.match(sql, /COMMIT;$/);
});

test("migrate obtains the advisory lock, applies pending migrations, and unlocks", async () => {
  await withMigrationDirectory(async (directory) => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");
    const queries = [];
    const executor = {
      async query(sql) {
        queries.push(sql);
        if (sql.startsWith("SELECT version, checksum")) {
          return { stdout: "", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
    };

    const result = await migrate({ directory, executor });

    assert.deepEqual(result.applied, ["0001"]);
    assert.ok(queries.some((query) => query.includes("pg_advisory_lock")));
    assert.ok(queries.some((query) => query.includes("BEGIN;")));
    assert.ok(queries.some((query) => query.includes("pg_advisory_unlock")));
  });
});

test("status reports applied and pending migrations", async () => {
  await withMigrationDirectory(async (directory) => {
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");
    await writeFile(join(directory, "0002_second.sql"), "SELECT 2;\n");
    const migrations = await discoverMigrations(directory);
    const executor = {
      query: async () => ({ stdout: `0001\t${migrations[0].checksum}\n`, stderr: "" }),
    };

    assert.deepEqual(
      (await status({ directory, executor })).map((item) => item.state),
      ["applied", "pending"],
    );
  });
});
