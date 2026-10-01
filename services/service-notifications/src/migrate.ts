import { readFile } from "node:fs/promises";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try { await pool.query(await readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8")); }
finally { await pool.end(); }
