import{after,before,describe,it}from"node:test";
import assert from"node:assert/strict";
import{randomUUID}from"node:crypto";
import{Pool}from"pg";

const url=process.env.SHELF_LIFE_TEST_DATABASE_URL;
if(!url)throw new Error("SHELF_LIFE_TEST_DATABASE_URL is required.");
const base=process.env.SHELF_LIFE_TEST_URL??"http://127.0.0.1:3404";
const familyBase=process.env.SHELF_LIFE_TEST_FAMILY_URL??"http://127.0.0.1:3311";
const inventoryBase=process.env.SHELF_LIFE_TEST_INVENTORY_URL??"http://127.0.0.1:3312";
const token=process.env.INTERNAL_SERVICE_TOKEN??"dispensa-internal-dev";
const pool=new Pool({connectionString:url});
const user=randomUUID();
const product=randomUUID();
let familyId:string|undefined;
let itemId:string|undefined;
let predictionId:string|undefined;

async function q(baseUrl:string,path:string,init:RequestInit={}){const r=await fetch(baseUrl+path,init);const t=await r.text();return{r,b:t?JSON.parse(t):undefined}}

before(async()=>{
  const health=await q(base,"/health/ready");assert.equal(health.r.status,200);
  const family=await q(familyBase,"/api/v1/families",{method:"POST",headers:{"x-user-id":user,"x-idempotency-key":"family-"+randomUUID(),"content-type":"application/json"},body:JSON.stringify({name:"Shelf test family"})});
  assert.equal(family.r.status,201);
  familyId=family.b.data.familyId;
  const stock=await q(inventoryBase,"/api/v1/inventory/items",{method:"POST",headers:{"x-user-id":user,"x-family-id":familyId!,"x-idempotency-key":"stock-"+randomUUID(),"content-type":"application/json"},body:JSON.stringify({productId:product,quantity:1,unit:"piece",location:"fridge"})});
  assert.equal(stock.r.status,201);
  itemId=stock.b.data.itemId;
});

after(async()=>{
  await pool.query("delete from shelf_life_domain.outbox_events where family_id=$1",[familyId]).catch(()=>{});
  await pool.query("delete from shelf_life_domain.predictions where family_id=$1",[familyId]).catch(()=>{});
  await pool.query("delete from shelf_life_domain.idempotency_keys where actor_user_id=$1",[user]).catch(()=>{});
  await pool.end();
  if(familyId){
    const family=await q(familyBase,"/api/v1/families/"+familyId,{headers:{"x-user-id":user}});
    if(family.r.status===200){
      await q(familyBase,"/api/v1/families/"+familyId,{method:"DELETE",headers:{"x-user-id":user,"x-idempotency-key":"cleanup-"+randomUUID(),"if-match":String(family.b.data.version)}});
    }
  }
});

describe("service-shelf-life / real lifecycle",()=>{
  it("queues a prediction and writes the durable event",async()=>{
    assert.ok(familyId&&itemId);
    const x=await q(base,"/api/v1/shelf-life/predictions",{method:"POST",headers:{"x-user-id":user,"x-family-id":familyId!,"x-idempotency-key":"prediction-"+randomUUID(),"content-type":"application/json"},body:JSON.stringify({itemId,productId,storedAt:"fridge",opened:false})});
    assert.equal(x.r.status,202);
    predictionId=x.b.data.predictionId;
    assert.equal(x.b.data.status,"queued");
    const db=await pool.query("select status,item_id,product_id from shelf_life_domain.predictions where id=$1",[predictionId]);
    assert.equal(db.rows[0].status,"queued");
    assert.equal(db.rows[0].item_id,itemId);
    assert.equal(db.rows[0].product_id,product);
    const event=await pool.query("select event_type from shelf_life_domain.outbox_events where aggregate_id=$1",[predictionId]);
    assert.equal(event.rows[0].event_type,"ShelfLifePredictionQueued");
  });

  it("processes through the internal service boundary with the real rule engine",async()=>{
    assert.ok(predictionId&&familyId);
    await pool.query("insert into shelf_life_domain.rules(product_category,storage,opened,min_days,max_days,model_version,active) values('dairy','FRIDGE',false,3,5,'test-model',true)");
    const x=await q(base,"/api/v1/internal/shelf-life/predictions/"+predictionId+"/process",{method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({storedAt:"fridge",opened:false,category:"dairy"})});
    assert.equal(x.r.status,200);
    assert.equal(x.b.data.status,"completed");
    assert.ok(x.b.data.estimated_expires_at??x.b.data.estimatedExpiresAt);
    const db=await pool.query("select status,confidence,model_version from shelf_life_domain.predictions where id=$1",[predictionId]);
    assert.equal(db.rows[0].status,"completed");
    assert.equal(Number(db.rows[0].confidence)>0,true);
    assert.equal(db.rows[0].model_version,"test-model");
  });

  it("reads the documented prediction DTO without leaking internal version",async()=>{
    assert.ok(predictionId&&familyId);
    const x=await q(base,"/api/v1/shelf-life/predictions/"+predictionId,{headers:{"x-user-id":user,"x-family-id":familyId!}});
    assert.equal(x.r.status,200);
    assert.deepEqual(Object.keys(x.b.data).sort(),["basis","confidence","estimatedExpiresAt","itemId","predictionId","status"].sort());
  });

  it("applies the prediction through real Inventory and marks it applied",async()=>{
    assert.ok(predictionId&&familyId&&itemId);
    const x=await q(base,"/api/v1/shelf-life/predictions/"+predictionId+"/apply",{method:"POST",headers:{"x-user-id":user,"x-family-id":familyId!,"x-idempotency-key":"apply-"+randomUUID(),"content-type":"application/json"},body:"{}"});
    assert.equal(x.r.status,200);
    assert.equal(x.b.data.status,"applied");
    const item=await q(inventoryBase,"/api/v1/inventory/"+itemId,{headers:{"x-user-id":user,"x-family-id":familyId!}});
    assert.equal(item.r.status,200);
    assert.equal(item.b.data.expirationSource,"estimated");
  });
});
