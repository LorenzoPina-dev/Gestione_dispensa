import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const migrationsDir = join(process.cwd(), "migrations");

try {
  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const file of files) {
    await pool.query(await readFile(join(migrationsDir, file), "utf8"));
    console.log(JSON.stringify({ service: "recipes", migration: file, status: "ok" }));
  }
} finally {
  await pool.end();
}
