import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import{randomUUID}from"node:crypto";
import{Pool}from"pg";
import{PostgresJobAdminRepository,PostgresJobReplayPublisher,PostgresSecurityAuditWriter}from"../src/jobs/postgres.js";
import{JobAdministrationService}from"../src/jobs/admin.js";

const url=process.env.JOBS_TEST_DATABASE_URL;
if(!url)throw new Error("JOBS_TEST_DATABASE_URL is required.");
const pool=new Pool({connectionString:url});
const principal:any={subject:randomUUID(),issuer:"https://test",audience:["account"],expiresAt:new Date(Date.now()+60000),issuedAt:new Date(),roles:[],scopes:["operator"]};
let jobId:string;
let dlqId:string;

before(async()=>{
  await pool.query("select 1");
  jobId=randomUUID();
  dlqId=randomUUID();
  await pool.query(
    "insert into jobs(id,capability,status,idempotency_key,payload,trace_id) values($1,'shelf_life_prediction','PENDING',$2,$3::jsonb,$4)",
    [jobId,"integration-"+jobId,JSON.stringify({itemId:randomUUID()}),randomUUID()],
  );
  await pool.query(
    "insert into dead_letter_jobs(id,job_id,queue,reason,attempts,failed_at,original_created_at) values($1,$2,'q:shelf-life-prediction','timeout',5,now(),now())",
    [dlqId,jobId],
  );
});

after(async()=>{
  await pool.query("delete from audit_events where actor_id=$1",[principal.subject]);
  await pool.query("delete from dead_letter_jobs where id=$1",[dlqId]);
  await pool.query("delete from jobs where id=$1",[jobId]);
  await pool.end();
});

describe("service-jobs / real PostgreSQL integration",()=>{
  it("reads a real job row through the repository mapping",async()=>{

  });

  it("replays a real DLQ record and creates a new PENDING job row",async()=>{
    const dbFactory={
      transaction:async()=>{
        const client=await pool.connect();
        await client.query("begin");
        return {
          query:async(text:string,values:any[]=[])=>({rows:(await client.query(text,values)).rows}),
          commit:async()=>{await client.query("commit");client.release();},
          rollback:async()=>{await client.query("rollback");client.release();}
        };
      }
    } as any;
    const repo=new PostgresJobAdminRepository(dbFactory);
    const publisher=new PostgresJobReplayPublisher(dbFactory);
    const audit=new PostgresSecurityAuditWriter(dbFactory);
    const service=new JobAdministrationService(repo,publisher,audit,randomUUID,()=>123456);
    const result=await service.replay(principal,dlqId,{reason:"integration replay",approvalId:"APR-INTEGRATION-1",traceId:randomUUID()});
    assert.equal(result.jobId,jobId);
    const dlq=await pool.query("select replay_count from dead_letter_jobs where id=$1",[dlqId]);
    assert.equal(Number(dlq.rows[0].replay_count),1);
    const replay=await pool.query("select capability,status,idempotency_key from jobs where id<>$1 and idempotency_key=$2",[jobId,"replay-"+result.replayId]);
    assert.equal(replay.rowCount,1);
    assert.equal(replay.rows[0].capability,"shelf_life_prediction");
    assert.equal(replay.rows[0].status,"PENDING");
    assert.equal(replay.rows[0].idempotency_key,"replay-"+result.replayId);
  });
});
