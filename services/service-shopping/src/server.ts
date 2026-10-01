import express from "express";
import { Pool } from "pg";
import crypto from "node:crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));
const port = Number(process.env.PORT ?? 3313);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type ItemState = "open" | "checked";
const json = (res: express.Response, status: number, body: unknown) => res.status(status).json(body);
const fail = (res: express.Response, status: number, code: string, message: string) =>
  json(res, status, { error: { code, message, details: [], requestId: crypto.randomUUID() } });

async function init() {
  await pool.query(`create schema if not exists shopping_domain`);
  await pool.query(`create table if not exists shopping_domain.lists (
    id uuid primary key, family_id uuid not null, name varchar(200) not null,
    status varchar(16) not null default 'open' check(status in ('open','closed')),
    version integer not null default 1, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await pool.query(`create table if not exists shopping_domain.items (
    id uuid primary key, list_id uuid not null references shopping_domain.lists(id) on delete cascade,
    product_id uuid, label varchar(300) not null, quantity numeric(14,3) not null check(quantity > 0),
    unit varchar(16) not null, checked boolean not null default false,
    version integer not null default 1, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`);
  await pool.query(`create index if not exists shopping_lists_family_idx on shopping_domain.lists(family_id,status)`);
  await pool.query(`create index if not exists shopping_items_list_idx on shopping_domain.items(list_id)`);
}
function limit(req: express.Request) { return Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100); }
function cursorOffset(req: express.Request) { const n = Number(req.query.cursor ?? 0); return Number.isFinite(n) && n >= 0 ? n : 0; }

app.get("/health/live", (_req, res) => json(res, 200, { status: "ok", service: "service-shopping" }));
app.get("/health/ready", async (_req, res) => { try { await pool.query("select 1"); json(res, 200, { status: "ready", service: "service-shopping" }); } catch { json(res, 503, { status: "not_ready", service: "service-shopping" }); } });

app.get("/api/v1/shopping/lists", async (req, res) => {
  const familyId = String(req.query.familyId ?? "");
  if (!familyId) return fail(res, 400, "VALIDATION_ERROR", "familyId is required.");
  const l = limit(req), o = cursorOffset(req);
  const q = await pool.query(`select l.*, count(i.id)::int item_count from shopping_domain.lists l left join shopping_domain.items i on i.list_id=l.id where l.family_id=$1 group by l.id order by l.created_at desc limit $2 offset $3`, [familyId,l,o]);
  return json(res,200,{items:q.rows.map(x=>({listId:x.id,name:x.name,status:x.status,itemCount:x.item_count,version:x.version})),nextCursor:q.rows.length===l?String(o+l):null});
});

app.post("/api/v1/shopping/lists", async (req,res) => {
  const familyId = String(req.body?.familyId ?? req.header("x-family-id") ?? "");
  const name = String(req.body?.name ?? "").trim();
  if (!familyId || !name) return fail(res,400,"VALIDATION_ERROR","familyId and name are required.");
  const id=crypto.randomUUID();
  const q=await pool.query(`insert into shopping_domain.lists(id,family_id,name) values($1,$2,$3) returning *`,[id,familyId,name]);
  return json(res,201,{data:{listId:q.rows[0].id,name:q.rows[0].name,status:q.rows[0].status,version:q.rows[0].version},version:q.rows[0].version});
});

app.get("/api/v1/shopping/lists/:listId", async (req,res) => {
  const q=await pool.query(`select * from shopping_domain.lists where id=$1`,[req.params.listId]);
  if(!q.rowCount)return fail(res,404,"NOT_FOUND","Shopping list not found.");
  const items=await pool.query(`select * from shopping_domain.items where list_id=$1 order by created_at`,[req.params.listId]);
  const l=q.rows[0];
  return json(res,200,{data:{listId:l.id,name:l.name,status:l.status,items:items.rows.map(x=>({itemId:x.id,listId:l.id,productId:x.product_id,label:x.label,quantity:Number(x.quantity),unit:x.unit,checked:x.checked,version:x.version})),version:l.version}});
});

app.post("/api/v1/shopping/lists/:listId/items", async (req,res) => {
  const {productId=null,label,quantity,unit}=req.body??{};
  if(!label||!Number.isFinite(Number(quantity))||Number(quantity)<=0||!unit)return fail(res,400,"VALIDATION_ERROR","label, quantity and unit are required.");
  const id=crypto.randomUUID();
  const c=await pool.connect();
  try{await c.query("begin");const l=await c.query(`select * from shopping_domain.lists where id=$1 for update`,[req.params.listId]);if(!l.rowCount){await c.query("rollback");return fail(res,404,"NOT_FOUND","Shopping list not found.");}
    const q=await c.query(`insert into shopping_domain.items(id,list_id,product_id,label,quantity,unit) values($1,$2,$3,$4,$5,$6) returning *`,[id,req.params.listId,productId,label,quantity,unit]);
    await c.query(`update shopping_domain.lists set version=version+1,updated_at=now() where id=$1`,[req.params.listId]);await c.query("commit");
    const x=q.rows[0];return json(res,201,{data:{itemId:x.id,listId:req.params.listId,productId:x.product_id,label:x.label,quantity:Number(x.quantity),unit:x.unit,checked:x.checked,version:x.version},version:l.rows[0].version+1});
  }catch(e){await c.query("rollback");return fail(res,400,"VALIDATION_ERROR",String(e));}finally{c.release();}
});

app.patch("/api/v1/shopping/lists/:listId/items/:itemId", async(req,res)=>{
  const state=req.body?.checked;
  if(typeof state!=="boolean")return fail(res,400,"VALIDATION_ERROR","checked is required.");
  const q=await pool.query(`update shopping_domain.items set checked=$1,version=version+1,updated_at=now() where id=$2 and list_id=$3 returning *`,[state,req.params.itemId,req.params.listId]);
  if(!q.rowCount)return fail(res,404,"NOT_FOUND","Shopping item not found.");
  const x=q.rows[0];return json(res,200,{data:{itemId:x.id,listId:req.params.listId,productId:x.product_id,label:x.label,quantity:Number(x.quantity),unit:x.unit,checked:x.checked,version:x.version},version:x.version});
});

app.delete("/api/v1/shopping/lists/:listId/items/:itemId",async(req,res)=>{
  const q=await pool.query(`delete from shopping_domain.items where id=$1 and list_id=$2 returning id`,[req.params.itemId,req.params.listId]);
  if(!q.rowCount)return fail(res,404,"NOT_FOUND","Shopping item not found.");
  await pool.query(`update shopping_domain.lists set version=version+1,updated_at=now() where id=$1`,[req.params.listId]);return res.status(204).end();
});

app.post("/api/v1/shopping/lists/:listId/close",async(req,res)=>{
  const q=await pool.query(`update shopping_domain.lists set status='closed',version=version+1,updated_at=now() where id=$1 returning *`,[req.params.listId]);
  if(!q.rowCount)return fail(res,404,"NOT_FOUND","Shopping list not found.");
  const x=q.rows[0];return json(res,200,{data:{listId:x.id,name:x.name,status:x.status,version:x.version},version:x.version});
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));
init().then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-shopping",port}))).catch(e=>{console.error(e);process.exit(1);});
