import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import{execFile}from"node:child_process";
import{promisify}from"node:util";
import{Pool}from"pg";

const url=process.env.IDENTITY_TEST_DATABASE_URL;
if(!url)throw new Error("IDENTITY_TEST_DATABASE_URL is required.");
const pool=new Pool({connectionString:url});
const run=promisify(execFile);

before(async()=>{
  await run("node",["dist/migrate.js"],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url}});
  await run("node",["dist/migrate.js"],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:url}});
});
after(async()=>pool.end());

describe("service-identity / real migration",()=>{
  it("records 001_initial exactly once",async()=>{
    const q=await pool.query("select version,count(*)over(partition by version)n from schema_migrations");
    assert.equal(q.rows.length,1);
    assert.equal(q.rows[0].version,"001_initial");
    assert.equal(Number(q.rows[0].n),1);
  });
  it("contains users, outbox and idempotency tables",async()=>{
    const q=await pool.query("select table_name,column_name from information_schema.columns where table_schema='public'");
    const s=new Set(q.rows.map(r=>r.table_name+"."+r.column_name));
    for(const x of [
      "users.id","users.subject","users.email","users.display_name","users.avatar_url",
      "users.locale","users.timezone","users.version",
      "outbox_events.event_id","outbox_events.event_type","outbox_events.payload",
      "idempotency_keys.key","idempotency_keys.actor_user_id","idempotency_keys.request_hash",
      "idempotency_keys.response_body","idempotency_keys.expires_at"
    ])assert.equal(s.has(x),true,"missing "+x);
  });
});
