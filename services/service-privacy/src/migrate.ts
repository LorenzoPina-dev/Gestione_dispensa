import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const dir = join(process.cwd(), "migrations");
const run = async () => {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations(version varchar(128) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const files = (await readdir(dir)).filter((f)=>/^\d+_.+\.sql$/.test(f)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  for (const file of files) {
    const client=await pool.connect();
    try {
      await client.query("begin");
      const version=file.replace(/\.sql$/,"");
      await client.query("select pg_advisory_xact_lock(hashtext($1))",[`${version}`]);
      const applied=await client.query("select 1 from schema_migrations where version=$1",[version]);
      if(!applied.rowCount){
        await client.query(await readFile(join(dir,file),"utf8"));
        await client.query("insert into schema_migrations(version) values($1)",[version]);
      }
      await client.query("commit");
    } catch(error){ await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
};
run().catch((e)=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
