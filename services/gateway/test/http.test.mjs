import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import{createServer}from"node:http";
import{spawn}from"node:child_process";
import{once}from"node:events";
import{randomUUID}from"node:crypto";

let upstream;
let gateway;
let upstreamBase="";
let gatewayBase="";

async function http(base,path,init={}){const r=await fetch(base+path,init);const t=await r.text();let body=undefined;try{body=t?JSON.parse(t):undefined}catch{body=t}return{r,body}}

before(async()=>{
  upstream=createServer((req,res)=>{
    res.setHeader("content-type","application/json");
    if(req.url==="/api/v1/auth/logout"&&req.method==="POST"){res.statusCode=204;return res.end();}
    if(req.url==="/api/v1/auth/register"&&req.method==="POST"){res.statusCode=201;return res.end(JSON.stringify({data:{success:true,message:"ok"}}));}
    res.statusCode=404;res.end(JSON.stringify({error:{code:"NOT_FOUND"}}));
  });
  await new Promise(resolve=>upstream.listen(0,"127.0.0.1",resolve));
  const ua=upstream.address();assert.ok(ua&&typeof ua==="object");upstreamBase="http://127.0.0.1:"+ua.port;

  gateway=spawn(process.execPath,["dist/index.js"],{
    cwd:process.cwd(),
    env:{...process.env,PORT:"3399",IDENTITY_SERVICE_BASE_URL:upstreamBase+"/api/v1",OIDC_ISSUER:"http://127.0.0.1:1/realms/dispensa",OIDC_AUDIENCE:"account"},
    stdio:["ignore","pipe","pipe"],
  });
  gatewayBase="http://127.0.0.1:3399";
  for(let i=0;i<60;i++){
    try{const r=await fetch(gatewayBase+"/health/live");if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  const stderr=await new Response(gateway.stderr).text().catch(()=> "");
  throw new Error("gateway did not start: "+stderr);
});

after(async()=>{
  if(gateway&&!gateway.killed){gateway.kill("SIGTERM");await once(gateway,"exit").catch(()=>{});}
  if(upstream)await new Promise(resolve=>upstream.close(()=>resolve()));
});

describe("gateway / documented public edge",()=>{
  it("exposes live health",async()=>{const x=await http(gatewayBase,"/health/live");assert.equal(x.r.status,200);assert.equal(x.body.status,"ok")});
  it("allows documented public registration",async()=>{const x=await http(gatewayBase,"/api/v1/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Mario",email:"mario@example.com",password:"password123"})});assert.equal(x.r.status,201);assert.equal(x.body.data.success,true)});
  it("keeps documented logout public",async()=>{const x=await http(gatewayBase,"/api/v1/auth/logout",{method:"POST"});assert.equal(x.r.status,204)});
  it("does not expose the undocumented /meta API",async()=>{const x=await http(gatewayBase,"/api/v1/meta");assert.equal(x.r.status,404)});
  it("does not expose internal Jobs as a browser API",async()=>{const x=await http(gatewayBase,"/api/v1/jobs/00000000-0000-4000-8000-000000000001");assert.equal(x.r.status,401);assert.equal(x.body.error.code,"UNAUTHENTICATED")});
  it("protects screen composites with gateway authentication",async()=>{const x=await http(gatewayBase,"/api/v1/views/dashboard-today?familyId=00000000-0000-4000-8000-000000000001");assert.equal(x.r.status,401);assert.equal(x.body.error.code,"UNAUTHENTICATED")});
  it("protects canonical domain APIs with gateway authentication",async()=>{for(const path of ["/api/v1/families","/api/v1/inventory","/api/v1/catalog/products/00000000-0000-4000-8000-000000000001","/api/v1/shopping/lists","/api/v1/recipes","/api/v1/nutrition/targets","/api/v1/stores","/api/v1/notifications"]){const x=await http(gatewayBase,path);assert.equal(x.r.status,401,path);assert.equal(x.body.error.code,"UNAUTHENTICATED",path)}});
});