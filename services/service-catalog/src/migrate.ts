import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  const sql = await readFile(join(process.cwd(), "migrations", "001_initial.sql"), "utf8");
  await client.query(sql);
} finally {
  client.release();
  await pool.end();
}
