import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import{execFile}from"node:child_process";
import{promisify}from"node:util";
import{Pool}from"pg";

const url=process.env.PRIVACY_TEST_DATABASE_URL;
if(!url)throw new Error("PRIVACY_TEST_DATABASE_URL is required.");
const pool=new Pool({connectionString:url});
const run=promisify(execFile);

before(async()=>{
  for(let i=0;i<2;i++){
    await run("node",["dist/migrate.js"],{
      cwd:process.cwd(),
      env:{...process.env,DATABASE_URL:url},
    });
  }
});
after(async()=>pool.end());

describe("privacy migration",()=>{
  it("records every migration exactly once",async()=>{
    const q=await pool.query("select version,count(*)over(partition by version)n from schema_migrations order by version");
    assert.deepEqual(q.rows.map((row)=>row.version),["001_initial","002_runtime_tables","999_security"]);
    assert.ok(q.rows.every((row)=>Number(row.n)===1));
  });

  it("contains the runtime-owned tables used by the repositories",async()=>{
    const q=await pool.query("select table_name,column_name from information_schema.columns where table_schema='public'");
    const s=new Set(q.rows.map(r=>r.table_name+"."+r.column_name));
    for(const x of [
      "privacy_consents.user_id",
      "privacy_consents.purpose",
      "privacy_consents.granted",
      "privacy_consents.consent_version",
      "privacy_erasure_requests.id",
      "privacy_erasure_requests.family_id",
      "privacy_erasure_requests.requester_id",
      "privacy_erasure_requests.idempotency_key",
      "privacy_export_jobs.id",
      "privacy_export_jobs.family_id",
      "privacy_export_jobs.owner_id",
      "privacy_export_jobs.artifact_id",
      "export_artifacts.id",
      "export_artifacts.family_id",
      "export_artifacts.content",
      "audit_events.actor_id",
      "audit_events.action",
      "audit_events.resource_id",
      "audit_events.metadata",
      "idempotency_keys.key",
      "outbox_events.event_id",
      "outbox_events.payload"
    ])assert.equal(s.has(x),true,"missing "+x);
  });

  it("does not depend on the obsolete 001 tables for the runtime contract",async()=>{
    const obsolete=await pool.query("select to_regclass('public.consents') as consents,to_regclass('public.privacy_jobs') as privacy_jobs,to_regclass('public.erasure_requests') as erasure_requests");
    assert.equal(obsolete.rows[0].consents,null);
    assert.equal(obsolete.rows[0].privacy_jobs,null);
    assert.equal(obsolete.rows[0].erasure_requests,null);
  });
});