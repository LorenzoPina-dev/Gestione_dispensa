import{describe,it}from"node:test";import assert from"node:assert/strict";
import{PrivacyErasureService,PrivacyErasureError}from"../src/privacy/erasure.js";
import{PrivacyExportService,PrivacyExportError,PrivacyExportWorker}from"../src/privacy/export.js";
const principal:any={subject:"owner-1",issuer:"issuer",audience:["aud"],expiresAt:new Date(Date.now()+100000),issuedAt:new Date(),roles:["owner"],scopes:[]};
const member={familyId:"family-1",userId:"owner-1",role:"OWNER",status:"ACTIVE"};
function audit(){return{append:async()=>{}}}function publisher(){return{published:[] as any[],publish:async(x:any)=>{publisher().published.push(x)}}}
describe("privacy domain",()=>{
 it("requires authentication, owner membership and explicit confirmation for erasure",async()=>{
  const repo:any={createOrGetErasure:async()=>({created:true,request:{id:"e1",familyId:"family-1",requesterId:"owner-1",idempotencyKey:"k",status:"REQUESTED",createdAt:1}}),listConsents:async()=>[],upsertConsent:async(x:any)=>x};
  const pub={publish:async()=>{}};const own={getMembership:async()=>member};
  const s=new PrivacyErasureService(repo,own,pub,audit(),()=>1);
  await assert.rejects(()=>s.request(undefined,"family-1",true,"idempotency","trace"),(e:any)=>e.code==="UNAUTHENTICATED");
  await assert.rejects(()=>s.request(principal,"family-1",false,"idempotency","trace"),(e:any)=>e.code==="CONFIRMATION_REQUIRED");
  const x=await s.request(principal,"family-1",true,"idempotency","trace");assert.equal(x.id,"e1");
 });
 it("updates and lists consent snapshots",async()=>{
  let stored:any;const repo:any={upsertConsent:async(x:any)=>(stored=x),listConsents:async()=>[stored]};
  const s=new PrivacyErasureService(repo,{getMembership:async()=>member},{publish:async()=>{}},audit(),()=>123);
  const x=await s.updateConsent(principal,"analytics",true,"privacy-v1","trace");assert.equal(x.purpose,"analytics");assert.equal(x.granted,true);assert.equal(x.updatedAt,123);
  const list=await s.listConsents(principal);assert.equal(list.length,1);
 });
 it("rejects invalid consent values",async()=>{
  const s=new PrivacyErasureService({} as any,{getMembership:async()=>member},{} as any,audit(),()=>1);
  await assert.rejects(()=>s.updateConsent(principal,"","x" as any,"","trace"),(e:any)=>e instanceof PrivacyErasureError&&e.code==="INVALID_CONSENT");
 });
 it("requires completed non-expired exports before artifact download",async()=>{
  const base={id:"x",familyId:"f",ownerId:"owner-1",status:"PENDING",createdAt:1};const repo:any={getExport:async()=>base};
  const s=new PrivacyExportService(repo,{getMembership:async()=>member},{publish:async()=>{}},{} as any,audit(),()=>10);
  await assert.rejects(()=>s.download(principal,"x","trace"),(e:any)=>e.code==="NOT_FOUND_OR_NOT_VISIBLE");
 });
 it("worker creates an expiring artifact and completes the export",async()=>{
  let completed:any;const repo:any={getExport:async()=>({id:"x",familyId:"f",ownerId:"owner-1",status:"PENDING",createdAt:1}),completeExport:async(x:any)=>{completed=x;return{...x,status:"COMPLETED"}}};
  let artifact:any;const worker=new PrivacyExportWorker(repo,{collectFamilyExport:async()=>({family:{id:"f"}})},{put:async(x:any)=>{artifact=x}},()=> "artifact-1",()=>1000,5000);
  const result=await worker.process("x");assert.equal(result.status,"COMPLETED");assert.equal(artifact.artifactId,"artifact-1");assert.equal(artifact.expiresAt,6000);assert.equal(completed.artifactId,"artifact-1");
 });
});
