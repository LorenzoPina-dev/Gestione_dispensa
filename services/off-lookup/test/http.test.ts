import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import{createServer}from"node:http";
import{spawn}from"node:child_process";
import{once}from"node:events";

let provider:any;
let service:any;
let providerBase="";
let base="http://127.0.0.1:3201";

async function q(path:string){const r=await fetch(base+path);const t=await r.text();let b:any;try{b=t?JSON.parse(t):undefined}catch{b=t}return{r,b}}

before(async()=>{
  provider=createServer((req,res)=>{
    res.setHeader("content-type","application/json");
    if(req.url?.includes("/product/404")){res.statusCode=404;return res.end();}
    if(req.url?.includes("/product/503")){res.statusCode=503;return res.end();}
    res.statusCode=200;
    res.end(JSON.stringify({status:"success",product:{product_name:"Latte from provider",brands:"Test Brand"}}));
  });
  await new Promise<void>(resolve=>provider.listen(0,"127.0.0.1",resolve));
  const a=provider.address();assert.ok(a&&typeof a==="object");providerBase="http://127.0.0.1:"+a.port;

  service=spawn(process.execPath,["dist/server.js"],{
    cwd:process.cwd(),
    env:{...process.env,OFF_LOOKUP_PORT:"3201",OFF_LOOKUP_MONGO_URL:"",OFF_LOOKUP_API_BASE_URL:providerBase,OFF_LOOKUP_API_TIMEOUT_MS:"500"},
    stdio:["ignore","pipe","pipe"],
  });

  for(let i=0;i<60;i++){
    try{const h=await fetch(base+"/health/live");if(h.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("off-lookup did not start");
});

after(async()=>{
  if(service&&!service.killed){service.kill("SIGTERM");await once(service,"exit").catch(()=>{});}
  await new Promise<void>(resolve=>provider.close(()=>resolve()));
});

describe("off-lookup / public HTTP contract",()=>{
  it("reports liveness and readiness without requiring Mongo",async()=>{
    const live=await q("/health/live");assert.equal(live.r.status,200);assert.equal(live.b.status,"ok");
    const ready=await q("/health/ready");assert.equal(ready.r.status,200);assert.equal(ready.b.status,"ok");assert.equal(ready.b.mongo.available,false);
  });
  it("rejects malformed barcodes before calling the provider",async()=>{
    const x=await q("/api/v1/products/not-a-barcode");assert.equal(x.r.status,400);assert.equal(x.b.error,"invalid_barcode");
  });
  it("falls through to the real local HTTP provider",async()=>{
    const x=await q("/api/v1/products/8001234567890");assert.equal(x.r.status,200);assert.equal(x.b.source,"live-api");assert.equal(x.b.product.product_name,"Latte from provider");
  });
  it("returns 404 only for provider-confirmed absence",async()=>{
    const x=await q("/api/v1/products/404");assert.equal(x.r.status,404);assert.equal(x.b.error,"product_not_found");
  });
  it("returns 503 for provider infrastructure failure",async()=>{
    const x=await q("/api/v1/products/503");assert.equal(x.r.status,503);assert.equal(x.b.error,"lookup_unavailable");assert.equal(x.r.headers.get("retry-after"),"5");
  });
  it("returns 404 for unknown paths",async()=>{const x=await q("/api/v1/nope");assert.equal(x.r.status,404);});
});
