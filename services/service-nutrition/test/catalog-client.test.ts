import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { loadNutritionSnapshot, nutrientMultiplier } from "../src/catalog-client.js";

let server: Server;
let baseUrl = "";
let mode: "ok"|"404"|"500"|"slow" = "ok";

before(async () => {
  server = createServer((req,res) => {
    if (mode === "404") { res.statusCode = 404; return res.end(); }
    if (mode === "500") { res.statusCode = 500; return res.end(); }
    if (mode === "slow") return setTimeout(() => { res.statusCode=200; res.setHeader("content-type","application/json"); res.end(JSON.stringify({data:{nutrition:{kcalPer100g:10},source:{type:"manual"},version:2}})); },100);
    res.statusCode = 200; res.setHeader("content-type","application/json");
    res.end(JSON.stringify({data:{nutrition:{kcalPer100g:62,proteinGPer100g:3.2,carbsGPer100g:4.8,fatGPer100g:3.5,fiberGPer100g:0},source:{type:"manual"},version:3}}));
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const a=server.address(); assert.ok(a&&typeof a==="object"); baseUrl="http://127.0.0.1:"+a.port;
});
after(async()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));

describe("nutrition catalog boundary",()=>{
  before(()=>{mode="ok";});
  it("maps the documented catalog nutrition DTO",async()=>{
    const x=await loadNutritionSnapshot(baseUrl,undefined,"00000000-0000-4000-8000-000000000001");
    assert.deepEqual(x,{productName:"00000000-0000-4000-8000-000000000001",brand:null,caloriesKcalPer100g:62,proteinGPer100g:3.2,carbsGPer100g:4.8,fatGPer100g:3.5,fiberGPer100g:0,source:"manual",sourceProductVersion:3,confidence:"CONFIRMED",packageQuantityValue:null,packageQuantityUnit:null});
  });
  it("maps catalog 404 to no snapshot",async()=>{mode="404"; assert.equal(await loadNutritionSnapshot(baseUrl,undefined,"missing"),null);});
  it("does not hide catalog failures",async()=>{mode="500"; await assert.rejects(()=>loadNutritionSnapshot(baseUrl,undefined,"x"),/HTTP 500/);});
  it("uses the exact g/kg conversion documented by Nutrition",()=>{
    assert.equal(nutrientMultiplier(250,"g"),2.5);
    assert.equal(nutrientMultiplier(1,"kg"),10);
    assert.throws(()=>nutrientMultiplier(1,"l"),/require unit g or kg/);
  });
});
