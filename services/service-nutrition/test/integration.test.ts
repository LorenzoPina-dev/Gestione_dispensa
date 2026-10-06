import{after,before,describe,it}from"node:test";import assert from"node:assert/strict";import{Pool}from"pg";
const url=process.env.NUTRITION_TEST_DATABASE_URL;if(!url)throw new Error("NUTRITION_TEST_DATABASE_URL is required.");const base=process.env.NUTRITION_TEST_URL??"http://127.0.0.1:3402";const pool=new Pool({connectionString:url});const user="00000000-0000-4000-8000-000000000011";
async function q(p:string,i:RequestInit={}){const r=await fetch(base+p,i);const t=await r.text();return{r,b:t?JSON.parse(t):undefined}}
before(async()=>{await pool.query("select 1")});after(async()=>{await pool.query("delete from nutrition_domain.outbox_events where aggregate_id=$1",[user]).catch(()=>{});await pool.query("delete from nutrition_domain.targets where user_id=$1",[user]);await pool.query("delete from nutrition_domain.diary_entries where user_id=$1",[user]);await pool.query("delete from nutrition_domain.idempotency_keys where actor_user_id=$1",[user]);await pool.end()});
describe("nutrition real integration",()=>{
 it("creates and updates targets with real PostgreSQL and ETag semantics",async()=>{
  const h={"x-user-id":user,"x-idempotency-key":"nutrition-target-1","if-match":"1","content-type":"application/json"};
  const a=await q("/api/v1/nutrition/targets",{headers:{"x-user-id":user}});assert.equal(a.r.status,200);assert.equal(a.b.data.caloriesKcal,2000);
  const b=await q("/api/v1/nutrition/targets",{method:"PUT",headers:h,body:JSON.stringify({caloriesKcal:2200,proteinG:120,carbsG:250,fatG:70})});assert.equal(b.r.status,200);assert.equal(b.b.data.caloriesKcal,2200);assert.equal(b.b.version,1);
  const second=await q("/api/v1/nutrition/targets",{method:"PUT",headers:{...h,"x-idempotency-key":"nutrition-target-2","if-match":"1"},body:JSON.stringify({caloriesKcal:2250,proteinG:125,carbsG:255,fatG:72})});assert.equal(second.r.status,200);assert.equal(second.b.version,2);
  const stale=await q("/api/v1/nutrition/targets",{method:"PUT",headers:{...h,"x-idempotency-key":"nutrition-target-stale","if-match":"1"},body:JSON.stringify({caloriesKcal:2000,proteinG:100,carbsG:250,fatG:70})});assert.equal(stale.r.status,412);
 });
 it("stores a diary entry with immutable nutrition snapshot and aggregates it",async()=>{
  const productId="00000000-0000-4000-8000-000000000099";
  await pool.query(`insert into nutrition_domain.diary_entries(id,user_id,date,meal,product_id,quantity,unit,source,nutrition_snapshot) values(gen_random_uuid(),$1,current_date,'lunch',$2,250,'g','manual',$3::jsonb)`,[user,productId,JSON.stringify({caloriesKcalPer100g:100,proteinGPer100g:4,carbsGPer100g:10,fatGPer100g:2,fiberGPer100g:1})]);
  const list=await q("/api/v1/nutrition/diary?from=2000-01-01&to=2100-01-01",{headers:{"x-user-id":user}});assert.equal(list.r.status,200);assert.ok(list.b.items.some((x:any)=>x.productId===productId));
  const summary=await q("/api/v1/nutrition/summary?period=today",{headers:{"x-user-id":user}});assert.equal(summary.r.status,200);assert.equal(summary.b.data.caloriesKcal,250);assert.equal(summary.b.data.proteinG,10);
  await pool.query(`insert into nutrition_domain.diary_entries(id,user_id,date,meal,product_id,quantity,unit,source,source_movement_id,nutrition_snapshot) values(gen_random_uuid(),$1,current_date,'snack',$2,1,'piece','inventory',$3,$4::jsonb)`,[
    user,
    productId,
    "00000000-0000-4000-8000-000000000098",
    JSON.stringify({productName:"Test snack",caloriesKcalPer100g:230,proteinGPer100g:5,carbsGPer100g:30,fatGPer100g:8,fiberGPer100g:2,packageQuantityValue:90,packageQuantityUnit:"g",confidence:"ESTIMATED"})
  ]);
  const pieceSummary=await q("/api/v1/nutrition/summary?period=today",{headers:{"x-user-id":user}});
  assert.equal(pieceSummary.r.status,200);
  assert.equal(pieceSummary.b.data.caloriesKcal,457);
  assert.ok(pieceSummary.b.data.items.some((item:any)=>item.productName==="Test snack" && item.nutrients.calories===207));
 });

});