import express, { type Request, type Response } from "express";
import { createContextAwarePool, type PoolClient } from "@gestione-dispensa/runtime-db/postgres-client.js";
import crypto from "node:crypto";
import { isCurrency, isNonNegativeInteger, isOfferType, isPositiveOffer, isValidDate } from "./validation.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT ?? 3403);
const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });

type Body = Record<string, unknown>;

const fail = (res: Response, status: number, code: string, message: string): Response => { const requestId=crypto.randomUUID(); return res.status(status).json({error:{code,message,details:[],retryable:status>=502,requestId},meta:{requestId,traceId:requestId,schemaVersion:"1.0"}}); };

const actor = (req: Request): string => String(req.header("x-user-id") ?? "").trim();
const key = (req: Request): string | null => {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
};
const hash = (value: unknown): string => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function beginIdempotency(client: PoolClient, req: Request, body: unknown) {
  const idempotencyKey = key(req);
  const userId = actor(req);
  if (!idempotencyKey || !userId) return { kind: "missing" as const };
  const requestHash = hash(body);
  const existing = await client.query(
    "select actor_user_id,request_hash,status,response_status,response_body from stores_domain.idempotency_keys where key=$1 for update",
    [idempotencyKey],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (String(row.actor_user_id) !== userId || row.request_hash !== requestHash) return { kind: "conflict" as const };
    if (row.status === "completed") return { kind: "replay" as const, status: Number(row.response_status), response: row.response_body };
    return { kind: "new" as const };
  }
  await client.query(
    `insert into stores_domain.idempotency_keys(key,actor_user_id,family_id,request_hash,status,created_at,expires_at)
     values($1,$2,null,$3,'processing',now(),now()+interval '24 hours')`,
    [idempotencyKey, userId, requestHash],
  );
  return { kind: "new" as const };
}

async function finishIdempotency(client: PoolClient, req: Request, status: number, response: unknown) {
  const idempotencyKey = key(req);
  if (!idempotencyKey) return;
  await client.query(
    "update stores_domain.idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [idempotencyKey, status, JSON.stringify(response)],
  );
}

async function outbox(client: PoolClient, type: string, aggregateId: string, payload: unknown) {
  await client.query(
    `insert into stores_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
     values($1,$2,1,$3,null,$4,now(),$5::jsonb,now())`,
    [crypto.randomUUID(), type, aggregateId, crypto.randomUUID(), JSON.stringify(toEventPayload(payload))],
  );
}

function cursor(req: Request): number {
  const n = Number(req.query.cursor ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function limit(req: Request): number {
  return Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
}

const storeDto = (row: Record<string, unknown>) => ({
  storeId: String(row.id),
  name: String(row.name),
  chain: row.chain === null ? null : String(row.chain),
  address: row.address === null ? null : String(row.address),
});

function toEventPayload(payload: unknown): unknown {
  if (typeof payload === "object" && payload !== null && Object.hasOwn(payload as object, "data")) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

async function init(): Promise<void> {
  await pool.query("select 1");
}

app.get("/health/live", (_req,res) => res.json({status:"ok",service:"service-stores"}));
app.get("/health/ready", async (_req,res) => { try { await pool.query("select 1"); res.json({status:"ready",service:"service-stores"}); } catch { res.status(503).json({status:"not_ready"}); } });

app.get("/api/v1/stores", async(req,res)=>{
  const l=limit(req),o=cursor(req),q=String(req.query.q??"").trim();
  const result=await pool.query(
    `select * from stores_domain.stores where ($1='' or lower(name) like lower('%'||$1||'%')) order by name asc limit $2 offset $3`,
    [q,l,o],
  );
  const hasNext=result.rows.length>l;const rows=hasNext?result.rows.slice(0,l):result.rows;return res.json({items:rows.map((x)=>storeDto(x as Record<string,unknown>)),nextCursor:hasNext?String(o+l):null});
});

app.post("/api/v1/stores", async(req,res)=>{
  const userId=actor(req); if(!userId||!key(req))return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key and authentication are required.");
  const b=req.body as Body; const name=typeof b.name==="string"?b.name.trim():"";
  if(!name)return fail(res,400,"VALIDATION_ERROR","name is required.");
  const client=await pool.connect();
  try{
    await client.query("begin");const idem=await beginIdempotency(client,req,b);
    if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}
    const q=await client.query("insert into stores_domain.stores(id,name,chain,address) values($1,$2,$3,$4) returning *",[crypto.randomUUID(),name,b.chain??null,b.address??null]);
    const response={data:storeDto(q.rows[0] as Record<string,unknown>),version:1};await outbox(client,"StoreUpdated",String(q.rows[0].id),response);await finishIdempotency(client,req,201,response);await client.query("commit");return res.status(201).json(response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to create store.");}finally{client.release();}
});

app.get("/api/v1/stores/:storeId/prices", async(req,res)=>{
  const l=limit(req),o=cursor(req),productId=String(req.query.productId??"");
  const q=await pool.query("select * from stores_domain.prices where store_id=$1 and ($2='' or product_id=$2::uuid) order by observed_at desc limit $3 offset $4",[req.params.storeId,productId,l,o]);
  const hasNext=q.rows.length>l;const rows=hasNext?q.rows.slice(0,l):q.rows;return res.json({items:rows.map(x=>({priceId:x.id,productId:x.product_id,storeId:x.store_id,amountMinor:Number(x.amount_minor),currency:x.currency,observedAt:x.observed_at})),nextCursor:hasNext?String(o+l):null});
});

app.post("/api/v1/stores/:storeId/prices", async(req,res)=>{
  if(!actor(req)||!key(req))return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key and authentication are required.");
  const b=req.body as Body;const currency=String(b.currency??"").toUpperCase();const observedAt=new Date(String(b.observedAt??""));const amount=Number(b.amountMinor);
  if(typeof b.productId!=="string"||!isNonNegativeInteger(amount)||!isCurrency(currency)||!isValidDate(String(b.observedAt??""))||typeof b.source!=="string")return fail(res,400,"VALIDATION_ERROR","Invalid price.");
  const client=await pool.connect();
  try{await client.query("begin");const idem=await beginIdempotency(client,req,b);if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}
    const store=await client.query("select id from stores_domain.stores where id=$1",[req.params.storeId]);if(!store.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Store not found.");}
    const q=await client.query("insert into stores_domain.prices(id,store_id,product_id,amount_minor,currency,observed_at,source) values($1,$2,$3,$4,$5,$6,$7) returning *",[crypto.randomUUID(),req.params.storeId,b.productId,amount,currency,observedAt,b.source]);
    const x=q.rows[0];const response={data:{priceId:x.id,productId:x.product_id,storeId:x.store_id,amountMinor:Number(x.amount_minor),currency:x.currency,observedAt:x.observed_at},version:1};await outbox(client,"PriceObserved",String(x.id),response);await finishIdempotency(client,req,201,response);await client.query("commit");return res.status(201).json(response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to create price.");}finally{client.release();}
});

app.get("/api/v1/stores/:storeId/offers", async(req,res)=>{
  const l=limit(req),o=cursor(req),productId=String(req.query.productId??""),active=req.query.active==="true";
  const q=await pool.query("select * from stores_domain.offers where store_id=$1 and ($2=false or valid_to>=now()) and ($3='' or product_id=$3::uuid) order by valid_to asc limit $4 offset $5",[req.params.storeId,active,productId,l,o]);
  const hasNext=q.rows.length>l;const rows=hasNext?q.rows.slice(0,l):q.rows;return res.json({items:rows.map(x=>({offerId:x.id,productId:x.product_id,storeId:x.store_id,type:x.type,value:Number(x.value),validFrom:x.valid_from,validTo:x.valid_to})),nextCursor:hasNext?String(o+l):null});
});

app.post("/api/v1/stores/:storeId/offers", async(req,res)=>{
  if(!actor(req)||!key(req))return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key and authentication are required.");
  const b=req.body as Body;const type=String(b.type??"");const value=Number(b.value);const from=new Date(String(b.validFrom??""));const to=new Date(String(b.validTo??""));
  if(typeof b.productId!=="string"||!isOfferType(type)||!isPositiveOffer(value)||type==="percentage"&&value>100||Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>=to)return fail(res,400,"VALIDATION_ERROR","Invalid offer.");
  const client=await pool.connect();
  try{await client.query("begin");const idem=await beginIdempotency(client,req,b);if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}
    const store=await client.query("select id from stores_domain.stores where id=$1",[req.params.storeId]);if(!store.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Store not found.");}
    const q=await client.query("insert into stores_domain.offers(id,store_id,product_id,type,value,valid_from,valid_to) values($1,$2,$3,$4,$5,$6,$7) returning *",[crypto.randomUUID(),req.params.storeId,b.productId,type,value,from,to]);
    const x=q.rows[0];const response={data:{offerId:x.id,productId:x.product_id,storeId:x.store_id,type:x.type,value:Number(x.value),validFrom:x.valid_from,validTo:x.valid_to},version:x.version};await outbox(client,"OfferUpdated",String(x.id),response);await finishIdempotency(client,req,201,response);await client.query("commit");return res.status(201).json(response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to create offer.");}finally{client.release();}
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));
init().then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-stores",port})))).catch(e=>{console.error(e);process.exit(1)});
