import{describe,it}from"node:test";import assert from"node:assert/strict";import{ProductLookupService,isValidBarcode}from"../src/product-lookup-service.js";
describe("off-lookup domain",()=>{
 it("accepts only 6..14 numeric barcode input",()=>{for(const x of["123456","8001234567890","12345678901234"])assert.equal(isValidBarcode(x),true);for(const x of["","12345","123456789012345","12-34","abcdef"])assert.equal(isValidBarcode(x),false)});
 it("uses local cache before external API",async()=>{let api=0;const s=new ProductLookupService({findByCode:async()=>({name:"Latte",_cache_meta:{schemaVersion:2,enrichmentVersion:1}}),upsertFromLiveApi:async()=>{},recordRefreshAttempt:async()=>{}},{fetchProduct:async()=>{api++;return{status:"not_found"}},isCircuitOpen:()=>false});const r=await s.lookup("8001234567890");assert.equal(r.outcome,"hit");assert.equal(r.source,"cache");assert.equal(api,0)});
 it("falls back to live API on cache miss and asynchronously heals cache",async()=>{let stored:any;const s=new ProductLookupService({findByCode:async()=>undefined,upsertFromLiveApi:async(_b,p)=>{stored=p}},{fetchProduct:async()=>({status:"found",product:{product_name:"Latte"}}),isCircuitOpen:()=>false});const r=await s.lookup("8001234567890");assert.equal(r.source,"live-api");await new Promise(r=>setImmediate(r));assert.deepEqual(stored,{product_name:"Latte"})});
 it("distinguishes definitive not-found from unavailable infrastructure",async()=>{const mk=(x:any)=>new ProductLookupService({findByCode:async()=>undefined,upsertFromLiveApi:async()=>{}},{fetchProduct:async()=>x,isCircuitOpen:()=>false});assert.equal((await mk({status:"not_found"}).lookup("8001234567890")).outcome,"not_found");assert.equal((await mk({status:"error",reason:"timeout",retryable:true}).lookup("8001234567890")).outcome,"unavailable")});
 it("searches products through the ranked external search boundary",async()=>{
  let calls=0;
  const s=new ProductLookupService(
   {
    findByCode:async()=>undefined,
    upsertFromLiveApi:async()=>{},
    recordRefreshAttempt:async()=>{},
   },
   {
    fetchProduct:async()=>({status:"not_found"}),
    searchProducts:async(query,limit)=>{
     calls+=1;
     assert.equal(query,"golia");
     assert.equal(limit,8);
     return {status:"found",hits:[{code:"8001234567890",product:{product_name_it:"Golia Caramella",brands:"Perfetti"}}]};
    },
    isCircuitOpen:()=>false,
   },
  );
  assert.deepEqual(await s.search("go",8),{status:"found",hits:[]});
  const first=await s.search("  golia  ",8);
  const second=await s.search("golia",8);
  assert.equal(first.hits.length,1);
  assert.equal(second.hits.length,1);
  assert.equal(calls,1);
 });
 it("never lets cache write failure change a live hit",async()=>{const r=await new ProductLookupService({findByCode:async()=>undefined,upsertFromLiveApi:async()=>{throw new Error("db down")}},{fetchProduct:async()=>({status:"found",product:{name:"Latte"}}),isCircuitOpen:()=>false}).lookup("8001234567890");assert.equal(r.outcome,"hit")});
});