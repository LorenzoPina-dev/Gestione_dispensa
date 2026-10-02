import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import{randomUUID}from"node:crypto";
import{Pool}from"pg";
import{PostgresClient}from"../src/db/postgres-client.js";
import{PostgresPrivacyErasureRepository,PostgresPrivacyExportRepository,PostgresExportArtifactStore,PostgresPrivacyAuditWriter}from"../src/privacy/postgres.js";
import{PrivacyErasureService}from"../src/privacy/erasure.js";
import{PrivacyExportService}from"../src/privacy/export.js";

const url=process.env.PRIVACY_TEST_DATABASE_URL;
const familyUrl=process.env.PRIVACY_TEST_FAMILY_URL;
const jobsUrl=process.env.PRIVACY_TEST_JOBS_URL;
const internalToken=process.env.INTERNAL_SERVICE_TOKEN;
if(!url||!familyUrl||!jobsUrl||!internalToken)throw new Error("PRIVACY_TEST_DATABASE_URL, PRIVACY_TEST_FAMILY_URL, PRIVACY_TEST_JOBS_URL and INTERNAL_SERVICE_TOKEN are required.");
const db=PostgresClient.create({connectionString:url});
const rawPool=new Pool({connectionString:url});
const userId=randomUUID();
let familyId:string|undefined;
let eraseId:string|undefined;
let exportId:string|undefined;
const principal:any={subject:userId,issuer:"https://issuer",audience:["account"],expiresAt:new Date(Date.now()+600000),issuedAt:new Date(),roles:[],scopes:[]};

async function q(base:string,path:string,init:RequestInit={}){const r=await fetch(base+path,init);const t=await r.text();return{r,b:t?JSON.parse(t):undefined}}

const jobsPublisher={
  publish:async(input:{jobId:string;familyId:string;capability:"privacy.erasure"|"privacy.export";traceId:string})=>{
    const r=await fetch(jobsUrl+"/internal/jobs",{method:"POST",headers:{"authorization":"Bearer "+internalToken,"content-type":"application/json","x-idempotency-key":input.jobId},body:JSON.stringify({type:input.capability,payload:{familyId:input.familyId,jobId:input.jobId},deduplicationKey:input.jobId})});
    if(!r.ok)throw new Error("Jobs rejected privacy operation: "+r.status);
  }
};
const ownership={getMembership:async(fid:string,uid:string)=>{
  const r=await q(familyUrl,"/api/v1/families/"+fid+"/members",{headers:{"x-user-id":uid}});
  if(r.r.status!==200)return undefined;
  const m=r.b.items?.find((x:any)=>x.userId===uid);
  if(!m)return undefined;
  const role=m.role==="owner"?"OWNER":m.role.toUpperCase();
  return{familyId:fid,userId:uid,role,status:m.status};
}};

before(async()=>{
  await db.query("select 1");
  const family=await q(familyUrl,"/api/v1/families",{method:"POST",headers:{"x-user-id":userId,"x-idempotency-key":"privacy-family-"+randomUUID(),"content-type":"application/json"},body:JSON.stringify({name:"Privacy integration"})});
  assert.equal(family.r.status,201);
  familyId=family.b.data.familyId;
});

after(async()=>{
  if(familyId){
    await rawPool.query("delete from privacy_consents where user_id=$1",[userId]);
    await rawPool.query("delete from privacy_erasure_requests where family_id=$1",[familyId]);
    await rawPool.query("delete from privacy_export_jobs where family_id=$1",[familyId]);
    await rawPool.query("delete from export_artifacts where family_id=$1",[familyId]);
    await rawPool.query("delete from audit_events where family_id=$1",[familyId]).catch(()=>{});
    await rawPool.query("delete from outbox_events where family_id=$1",[familyId]).catch(()=>{});
    const family=await q(familyUrl,"/api/v1/families/"+familyId,{headers:{"x-user-id":userId}});
    if(family.r.status===200)await q(familyUrl,"/api/v1/families/"+familyId,{method:"DELETE",headers:{"x-user-id":userId,"x-idempotency-key":"privacy-cleanup-"+randomUUID(),"if-match":String(family.b.data.version)}});
  }
  await rawPool.end();await db.close();
});

describe("service-privacy / real domain integration",()=>{
  it("stores and reads consent in real PostgreSQL",async()=>{
    const repo=new PostgresPrivacyErasureRepository(db);
    const audit=new PostgresPrivacyAuditWriter(db);
    const service=new PrivacyErasureService(repo,ownership,jobsPublisher,audit,()=>1000);
    const consent=await service.updateConsent(principal,"analytics",true,"privacy-v1","trace-consent");
    assert.equal(consent.userId,userId);assert.equal(consent.granted,true);
    const list=await service.listConsents(principal);assert.equal(list[0].purpose,"analytics");
  });

  it("stores the complete documented consent set atomically",async()=>{
    const repo=new PostgresPrivacyErasureRepository(db);
    const audit=new PostgresPrivacyAuditWriter(db);
    const service=new PrivacyErasureService(repo,ownership,jobsPublisher,audit,()=>1500);
    const result=await service.updateConsents(principal,{analytics:false,personalization:true,notifications:true},"trace-consents");
    assert.equal(result.length,3);
    const rows=await rawPool.query("select purpose,granted from privacy_consents where user_id=$1 order by purpose",[userId]);
    assert.deepEqual(rows.rows,[
      {purpose:"analytics",granted:false},
      {purpose:"notifications",granted:true},
      {purpose:"personalization",granted:true},
    ]);
  });

  it("creates an erasure request after real Family owner authorization and publishes a real Jobs request",async()=>{
    assert.ok(familyId);
    const repo=new PostgresPrivacyErasureRepository(db);
    const audit=new PostgresPrivacyAuditWriter(db);
    const service=new PrivacyErasureService(repo,ownership,jobsPublisher,audit,()=>2000);
    const x=await service.request(principal,familyId,true,"erase-"+randomUUID(),"trace-erase");
    eraseId=x.id;
    assert.equal(x.status,"REQUESTED");
    const row=await rawPool.query("select status,requester_id from privacy_erasure_requests where id=$1",[x.id]);
    assert.equal(row.rows[0].status,"REQUESTED");assert.equal(row.rows[0].requester_id,userId);
  });

  it("creates an export job after the same real owner boundary and persists it",async()=>{
    assert.ok(familyId);
    const repo=new PostgresPrivacyExportRepository(db);
    const artifacts=new PostgresExportArtifactStore(db);
    const audit=new PostgresPrivacyAuditWriter(db);
    const service=new PrivacyExportService(repo,ownership,jobsPublisher,artifacts,audit,()=>3000);
    const x=await service.create(principal,familyId,"export-"+randomUUID(),"trace-export");
    exportId=x.id;
    assert.equal(x.status,"PENDING");
    const row=await rawPool.query("select status,owner_id from privacy_export_jobs where id=$1",[x.id]);
    assert.equal(row.rows[0].status,"PENDING");assert.equal(row.rows[0].owner_id,userId);
  });

  it("reuses the same export idempotency key without a duplicate row",async()=>{
    assert.ok(familyId);
    const repo=new PostgresPrivacyExportRepository(db);
    const audit=new PostgresPrivacyAuditWriter(db);
    const s=new PrivacyExportService(repo,ownership,jobsPublisher,new PostgresExportArtifactStore(db),audit,()=>4000);
    const key="export-replay-"+randomUUID();
    const a=await s.create(principal,familyId,key,"trace-a");
    const b=await s.create(principal,familyId,key,"trace-b");
    assert.equal(a.id,b.id);
    const rows=await rawPool.query("select count(*)::int n from privacy_export_jobs where family_id=$1 and idempotency_key=$2",[familyId,key]);
    assert.equal(rows.rows[0].n,1);
  });
});
