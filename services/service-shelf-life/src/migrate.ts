import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const files = (await readdir(join(process.cwd(), "migrations")))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const file of files) await pool.query(await readFile(join(process.cwd(), "migrations", file), "utf8"));
} finally { await pool.end(); }
