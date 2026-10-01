import express, { type Request, type Response } from "express";
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT ?? 3403);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Body = Record<string, unknown>;

const fail = (res: Response, status: number, code: string, message: string): Response =>
  res.status(status).json({ error: { code, message, details: [], requestId: crypto.randomUUID() } });

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
    [crypto.randomUUID(), type, aggregateId, crypto.randomUUID(), JSON.stringify(payload)],
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

async function init(): Promise<void> {
  await pool.query(`create schema if not exists stores_domain`);
  await pool.query(`create table if not exists stores_domain.stores(
    id uuid primary key,
    name varchar(300) not null check(length(trim(name))>0),
    chain varchar(200),
    address text,
    latitude numeric(9,6),
    longitude numeric(9,6),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version integer not null default 1
  )`);
  await pool.query(`create table if not exists stores_domain.prices(
    id uuid primary key,
    store_id uuid not null references stores_domain.stores(id) on delete cascade,
    product_id uuid not null,
    amount_minor bigint not null check(amount_minor>=0),
    currency char(3) not null check(currency ~ '^[A-Z]{3}$'),
    observed_at timestamptz not null,
    source varchar(64) not null,
    created_at timestamptz not null default now()
  )`);
  await pool.query(`create table if not exists stores_domain.offers(
    id uuid primary key,
    store_id uuid not null references stores_domain.stores(id) on delete cascade,
    product_id uuid not null,
    type varchar(32) not null check(type in ('percentage','fixed')),
    value numeric(12,4) not null check(value>=0),
    valid_from timestamptz not null,
    valid_to timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version integer not null default 1,
    check(valid_from < valid_to),
    check(type <> 'percentage' or value <= 100)
  )`);
  await pool.query(`create table if not exists stores_domain.idempotency_keys(
    key varchar(255) primary key,
    actor_user_id uuid not null,
    family_id uuid null,
    request_hash varchar(64) not null,
    status varchar(16) not null check(status in ('processing','completed','failed')),
    response_status integer null,
    response_body jsonb null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`);
  await pool.query(`create table if not exists stores_domain.outbox_events(
    event_id uuid primary key,
    event_type varchar(128) not null,
    schema_version integer not null,
    aggregate_id uuid not null,
    family_id uuid null,
    correlation_id uuid not null,
    occurred_at timestamptz not null,
    payload jsonb not null,
    published_at timestamptz null,
    attempts integer not null default 0,
    last_error text null,
    created_at timestamptz not null
  )`);
  await pool.query("create index if not exists stores_price_product_observed_idx on stores_domain.prices(store_id,product_id,observed_at desc)");
  await pool.query("create index if not exists stores_offer_validity_idx on stores_domain.offers(store_id,valid_from,valid_to)");
  await pool.query("create index if not exists stores_outbox_publish_idx on stores_domain.outbox_events(published_at,created_at)");
}

app.get("/health/live", (_req,res) => res.json({status:"ok",service:"service-stores"}));
app.get("/health/ready", async (_req,res) => { try { await pool.query("select 1"); res.json({status:"ready",service:"service-stores"}); } catch { res.status(503).json({status:"not_ready"}); } });

app.get("/api/v1/stores", async(req,res)=>{
  const l=limit(req),o=cursor(req),q=String(req.query.q??"").trim();
  const result=await pool.query(
    `select * from stores_domain.stores where ($1='' or lower(name) like lower('%'||$1||'%')) order by name asc limit $2 offset $3`,
    [q,l,o],
  );
  return res.json({items:result.rows.map((x)=>storeDto(x as Record<string,unknown>)),nextCursor:result.rows.length===l?String(o+l):null});
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
  return res.json({items:q.rows.map(x=>({priceId:x.id,productId:x.product_id,storeId:x.store_id,amountMinor:Number(x.amount_minor),currency:x.currency,observedAt:x.observed_at})),nextCursor:q.rows.length===l?String(o+l):null});
});

app.post("/api/v1/stores/:storeId/prices", async(req,res)=>{
  if(!actor(req)||!key(req))return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key and authentication are required.");
  const b=req.body as Body;const currency=String(b.currency??"").toUpperCase();const observedAt=new Date(String(b.observedAt??""));const amount=Number(b.amountMinor);
  if(typeof b.productId!=="string"||!Number.isSafeInteger(amount)||amount<0||!/^[A-Z]{3}$/.test(currency)||Number.isNaN(observedAt.getTime())||typeof b.source!=="string")return fail(res,400,"VALIDATION_ERROR","Invalid price.");
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
  return res.json({items:q.rows.map(x=>({offerId:x.id,productId:x.product_id,storeId:x.store_id,type:x.type,value:Number(x.value),validFrom:x.valid_from,validTo:x.valid_to})),nextCursor:q.rows.length===l?String(o+l):null});
});

app.post("/api/v1/stores/:storeId/offers", async(req,res)=>{
  if(!actor(req)||!key(req))return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key and authentication are required.");
  const b=req.body as Body;const type=String(b.type??"");const value=Number(b.value);const from=new Date(String(b.validFrom??""));const to=new Date(String(b.validTo??""));
  if(typeof b.productId!=="string"||!["percentage","fixed"].includes(type)||!Number.isFinite(value)||value<0||type==="percentage"&&value>100||Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>=to)return fail(res,400,"VALIDATION_ERROR","Invalid offer.");
  const client=await pool.connect();
  try{await client.query("begin");const idem=await beginIdempotency(client,req,b);if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}
    const store=await client.query("select id from stores_domain.stores where id=$1",[req.params.storeId]);if(!store.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Store not found.");}
    const q=await client.query("insert into stores_domain.offers(id,store_id,product_id,type,value,valid_from,valid_to) values($1,$2,$3,$4,$5,$6,$7) returning *",[crypto.randomUUID(),req.params.storeId,b.productId,type,value,from,to]);
    const x=q.rows[0];const response={data:{offerId:x.id,productId:x.product_id,storeId:x.store_id,type:x.type,value:Number(x.value),validFrom:x.valid_from,validTo:x.valid_to},version:x.version};await outbox(client,"OfferUpdated",String(x.id),response);await finishIdempotency(client,req,201,response);await client.query("commit");return res.status(201).json(response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to create offer.");}finally{client.release();}
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));
init().then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-stores",port})))).catch(e=>{console.error(e);process.exit(1)});
