import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import express from"express";
import{createServer,type Server}from"node:http";
import{generateKeyPair,exportJWK,SignJWT}from"jose";
import{createTestTokenVerifier}from"../src/identity/oidc.js";
import{PrivacyErasureService}from"../src/privacy/erasure.js";
import{PrivacyExportService}from"../src/privacy/export.js";
import{buildPrivacyRouter}from"../src/http/routes/privacy.js";
import{corsMiddleware,requestMetaMiddleware}from"../src/http/middleware.js";

const issuer="https://privacy-test.local/realms/dispensa";
const audience="account";
const userId="00000000-0000-4000-8000-000000000001";

const consentStore=new Map<string,{userId:string;purpose:string;granted:boolean;consentVersion:string;updatedAt:number}>();
const erasureRepository:any={
  createOrGetErasure:async()=>({created:true,request:{id:"e1",familyId:"family-1",requesterId:userId,idempotencyKey:"erase-12345678",status:"REQUESTED",createdAt:1}}),
  getErasure:async()=>undefined,
  markProcessing:async()=>{throw new Error("unused")},
  completeErasure:async()=>{throw new Error("unused")},
  failErasure:async()=>{throw new Error("unused")},
  upsertConsent:async(x:any)=>{consentStore.set(x.userId+":"+x.purpose,x);return x;},
  listConsents:async(uid:string)=>[...consentStore.values()].filter(x=>x.userId===uid),
  upsertConsentsAtomic:async({consents,idempotencyKey,requestHash}:any)=>{
    const state=(erasureRepository as any)._consentIdem ?? ((erasureRepository as any)._consentIdem=new Map());
    const prior=state.get(idempotencyKey);
    if(prior && prior.requestHash!==requestHash)return{consents:[],replay:false,conflict:true};
    if(prior)return{consents:prior.consents,replay:true,conflict:false};
    for(const x of consents)consentStore.set(x.userId+":"+x.purpose,x);
    state.set(idempotencyKey,{requestHash,consents});
    return{consents,replay:false,conflict:false};
  }
};
const audit={append:async()=>{}};
const ownership={getMembership:async()=>({familyId:"family-1",userId,role:"OWNER",status:"ACTIVE"})};
const erasure=new PrivacyErasureService(erasureRepository,ownership,{publish:async()=>{}},audit,()=>1700000000000);
const exportService=new PrivacyExportService(
  {createOrGetExport:async()=>({created:true,job:{id:"x",familyId:"f",ownerId:userId,idempotencyKey:"x",status:"PENDING",createdAt:1}})} as any,
  ownership,
  {publish:async()=>{}},
  {} as any,
  audit,
  ()=>1700000000000,
);

let server:Server;
let base="";
let authorization="";

async function request(path:string,init:RequestInit={}){const r=await fetch(base+path,init);const t=await r.text();let body;try{body=t?JSON.parse(t):undefined}catch{body=t}return{response:r,body}}

before(async()=>{
  const{publicKey,privateKey}=await generateKeyPair("RS256");
  const jwk=await exportJWK(publicKey);
  const verifier=createTestTokenVerifier(issuer,audience,{keys:[{...jwk,alg:"RS256",use:"sig"}]});
  const token=await new SignJWT({scope:"openid profile"}).setProtectedHeader({alg:"RS256"}).setIssuer(issuer).setAudience(audience).setSubject(userId).setIssuedAt().setExpirationTime("1h").sign(privateKey);
  authorization="Bearer "+token;
  const app=express();app.use(corsMiddleware());app.use(requestMetaMiddleware());app.use(express.json({limit:"2mb"}));
  app.use("/api/v1",buildPrivacyRouter({erasure,export:exportService,verifier}));
  server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address==="object");base="http://127.0.0.1:"+address.port;
});

after(async()=>{await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));});

describe("service-privacy / real Express HTTP adapter",()=>{
  it("rejects protected requests without authentication",async()=>{
    const x=await request("/api/v1/privacy/consents");
    assert.equal(x.response.status,401);
    assert.equal(x.body?.error?.code,"UNAUTHENTICATED");
    assert.equal(x.body?.meta?.schemaVersion,"1.0");
  });

  it("returns the documented consent-set shape",async()=>{
    consentStore.clear();
    const x=await request("/api/v1/privacy/consents",{headers:{authorization}});
    assert.equal(x.response.status,200);
    assert.deepEqual(x.body?.data,{analytics:false,personalization:false,notifications:false});
    assert.equal(x.body?.version,1);
    assert.equal(x.body?.meta?.schemaVersion,"1.0");
    assert.deepEqual(Object.keys(x.body?.data??{}).sort(),["analytics","notifications","personalization"]);
  });

  it("updates all documented consents atomically and idempotency is mandatory",async()=>{
    const missingKey=await request("/api/v1/privacy/consents",{method:"PUT",headers:{authorization,"content-type":"application/json"},body:JSON.stringify({analytics:true,personalization:false,notifications:true})});
    assert.equal(missingKey.response.status,400);
    assert.equal(missingKey.body?.error?.code,"VALIDATION_ERROR");

    const x=await request("/api/v1/privacy/consents",{method:"PUT",headers:{authorization,"content-type":"application/json","idempotency-key":"privacy-consents-1"},body:JSON.stringify({analytics:true,personalization:false,notifications:true})});
    assert.equal(x.response.status,200);
    assert.deepEqual(x.body?.data,{analytics:true,personalization:false,notifications:true});
    assert.equal(x.body?.version,1);
    const replay=await request("/api/v1/privacy/consents",{method:"PUT",headers:{authorization,"content-type":"application/json","idempotency-key":"privacy-consents-1"},body:JSON.stringify({analytics:true,personalization:false,notifications:true})});
    assert.equal(replay.response.status,200);
    assert.deepEqual(replay.body?.data,x.body?.data);
    const conflict=await request("/api/v1/privacy/consents",{method:"PUT",headers:{authorization,"content-type":"application/json","idempotency-key":"privacy-consents-1"},body:JSON.stringify({analytics:false,personalization:false,notifications:true})});
    assert.equal(conflict.response.status,409);
    assert.equal(conflict.body?.error?.code,"IDEMPOTENCY_CONFLICT");
  });

  it("rejects undocumented consent fields",async()=>{
    const x=await request("/api/v1/privacy/consents",{method:"PUT",headers:{authorization,"content-type":"application/json","idempotency-key":"privacy-consents-2"},body:JSON.stringify({analytics:true,personalization:false,notifications:true,purpose:"analytics"})});
    assert.equal(x.response.status,400);
    assert.equal(x.body?.error?.code,"VALIDATION_ERROR");
  });

  it("uses 405 for an unsupported method on the consent route",async()=>{
    const x=await request("/api/v1/privacy/consents",{method:"POST",headers:{authorization}});
    assert.equal(x.response.status,405);
    assert.equal(x.body?.error?.code,"METHOD_NOT_ALLOWED");
  });
});
