import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const sql = await readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8");
  await pool.query(sql);
} finally {
  await pool.end();
}
