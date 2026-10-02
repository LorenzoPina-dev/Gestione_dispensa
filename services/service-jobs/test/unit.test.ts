import{describe,it}from"node:test";import assert from"node:assert/strict";
import{JobAdministrationService,JobAdminError}from"../src/jobs/admin.js";
const operator:any={subject:"operator-1",issuer:"issuer",audience:["aud"],expiresAt:new Date(Date.now()+100000),issuedAt:new Date(),roles:[],scopes:["operator"]};
const job:any={id:"j1",capability:"shelf_life_prediction",status:"PENDING",currentAttempt:0,maxAttempts:5,nextAttemptAt:1,createdAt:1,updatedAt:1};
const dlq:any={id:"d1",jobId:"j1",queue:"shelf-life",reason:"transient",attempts:5,replayCount:0,failedAt:1,originalCreatedAt:1};
describe("jobs admin domain",()=>{
 it("denies anonymous inspect and records authorization-independent behavior",async()=>{const repo:any={getJob:async()=>job};const s=new JobAdministrationService(repo,{publish:async()=>{}},{append:async()=>{}},()=> "r1",()=>1);await assert.rejects(()=>s.inspect(undefined,"j1","trace"),(e:any)=>e instanceof JobAdminError&&e.code==="UNAUTHENTICATED")});
 it("returns an operator-visible job snapshot",async()=>{const s=new JobAdministrationService({getJob:async()=>job},{publish:async()=>{}},{append:async()=>{}},()=> "r1",()=>1);const x=await s.inspect(operator,"j1","trace");assert.equal(x.id,"j1")});
 it("requires replay reason and approval",async()=>{const s=new JobAdministrationService({getDeadLetter:async()=>dlq},{publish:async()=>{}},{append:async()=>{}},()=> "r1",()=>1);await assert.rejects(()=>s.replay(operator,"d1",{reason:"",approvalId:"",traceId:"t"}),(e:any)=>e.code==="APPROVAL_REQUIRED")});
 it("records replay and publishes the real replay command through injected boundaries",async()=>{let recorded:any,published:any;const s=new JobAdministrationService({getDeadLetter:async()=>dlq,recordReplay:async(x:any)=>{recorded=x}},{publish:async(x:any)=>{published=x}},{append:async()=>{}},()=> "r1",()=>55);const x=await s.replay(operator,"d1",{reason:"manual review",approvalId:"APR-1",traceId:"t"});assert.deepEqual(x,{replayId:"r1",jobId:"j1"});assert.equal(recorded.approvalId,"APR-1");assert.equal(published.jobId,"j1")});
});
