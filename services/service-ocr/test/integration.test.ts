import{after,before,describe,it}from"node:test";import assert from"node:assert/strict";import{randomUUID}from"node:crypto";import{Pool}from"pg";
const url=process.env.OCR_TEST_DATABASE_URL;if(!url)throw new Error("OCR_TEST_DATABASE_URL is required.");const base=process.env.OCR_TEST_URL??"http://127.0.0.1:3405";const familyBase=process.env.OCR_TEST_FAMILY_URL??"http://127.0.0.1:3311";const user=randomUUID();let family:string|undefined;const pool=new Pool({connectionString:url});let job:string,draft:string;
async function q(p:string,i:RequestInit={}){const r=await fetch(base+p,i);const t=await r.text();return{r,b:t?JSON.parse(t):undefined}}
before(async()=>{
  await pool.query("select 1");
  const response=await fetch(familyBase+"/api/v1/families",{method:"POST",headers:{"x-user-id":user,"x-idempotency-key":"ocr-family-"+randomUUID(),"content-type":"application/json"},body:JSON.stringify({name:"OCR integration"})});
  const body=await response.json() as any;
  assert.equal(response.status,201);
  family=body.data.familyId;
});
after(async()=>{
  if(job)await pool.query("delete from ocr_domain.ocr_jobs where id=$1",[job]);
  await pool.query("delete from ocr_domain.idempotency_keys where actor_user_id=$1",[user]);
  await pool.end();
  if(family){
    const current=await fetch(familyBase+"/api/v1/families/"+family,{headers:{"x-user-id":user}});
    if(current.ok){
      const data=await current.json() as any;
      await fetch(familyBase+"/api/v1/families/"+family,{method:"DELETE",headers:{"x-user-id":user,"x-idempotency-key":"ocr-cleanup-"+randomUUID(),"if-match":String(data.data.version)}});
    }
  }
});
describe("OCR real integration",()=>{it("rejects a malformed job and keeps the database unchanged",async()=>{const x=await q("/api/v1/ocr/jobs",{method:"POST",headers:{"x-user-id":user,"x-family-id":family!,"x-idempotency-key":"ocr-"+randomUUID(),"content-type":"application/json"},body:JSON.stringify({type:"invalid",familyId:family})});assert.equal(x.r.status,400);const n=await pool.query("select count(*)::int n from ocr_domain.ocr_jobs where user_id=$1",[user]);assert.equal(n.rows[0].n,0)});it("creates a real queued OCR job from multipart data",async()=>{const form=new FormData();form.append("type","receipt");form.append("familyId",family);form.append("file",new Blob(["receipt data"],{type:"image/jpeg"}),"receipt.jpg");const x=await q("/api/v1/ocr/jobs",{method:"POST",headers:{"x-user-id":user,"x-family-id":family,"x-idempotency-key":"ocr-create-"+randomUUID()},body:form});assert.equal(x.r.status,202);job=x.b.data.jobId;assert.ok(job);const row=await pool.query("select status,type,progress,object_key from ocr_domain.ocr_jobs where id=$1",[job]);assert.equal(row.rows[0].status,"queued");assert.equal(row.rows[0].type,"receipt");assert.equal(Number(row.rows[0].progress),0);assert.match(row.rows[0].object_key,/ocr\//)});it("returns queued job and lists it",async()=>{const x=await q("/api/v1/ocr/jobs/"+job,{headers:{"x-user-id":user,"x-family-id":family!}});assert.equal(x.r.status,200);assert.equal(x.b.data.status,"queued");const list=await q("/api/v1/ocr/jobs?familyId="+family,{headers:{"x-user-id":user}});assert.equal(list.r.status,200);assert.ok(list.b.items.some((x:any)=>x.jobId===job))})});