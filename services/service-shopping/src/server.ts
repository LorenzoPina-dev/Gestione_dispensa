import express from "express";
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT ?? 3313);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type ShoppingListStatus = "open" | "closed";
type Body = Record<string, unknown>;

const json = (res: express.Response, status: number, body: unknown): void => {
  res.status(status).json(body);
};

const fail = (
  res: express.Response,
  status: number,
  code: string,
  message: string,
  details: unknown[] = [],
): void => {
  json(res, status, {
    error: { code, message, details, requestId: crypto.randomUUID() },
  });
};

function requestContext(req: express.Request): { userId: string; familyId: string } | null {
  const userId = String(req.header("x-user-id") ?? "").trim();
  const familyId = String(req.query.familyId ?? req.body?.familyId ?? req.header("x-family-id") ?? "").trim();
  return userId && familyId ? { userId, familyId } : null;
}

function idempotencyKey(req: express.Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
}

function ifMatch(req: express.Request): number | null {
  const value = req.header("if-match");
  if (value === undefined) return null;
  const parsed = Number(value.replace(/^W\\/?/i, "").replace(/"/g, ""));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function hashBody(body: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

async function beginIdempotency(
  client: PoolClient,
  req: express.Request,
  ctx: { userId: string; familyId: string },
  body: unknown,
): Promise<{ kind: "new" } | { kind: "replay"; status: number; response: unknown } | { kind: "conflict" }> {
  const key = idempotencyKey(req);
  if (key === null) return { kind: "conflict" };
  const requestHash = hashBody(body);
  const existing = await client.query(
    "select actor_user_id,family_id,request_hash,status,response_status,response_body from shopping_domain.idempotency_keys where key=$1 for update",
    [key],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.actor_user_id !== ctx.userId || row.family_id !== ctx.familyId || row.request_hash !== requestHash) {
      return { kind: "conflict" };
    }
    if (row.status === "completed" && row.response_status !== null) {
      return { kind: "replay", status: Number(row.response_status), response: row.response_body };
    }
    return { kind: "new" };
  }
  await client.query(
    `insert into shopping_domain.idempotency_keys
      (key,actor_user_id,family_id,request_hash,status,created_at,expires_at)
     values($1,$2,$3,$4,'processing',now(),now()+interval '24 hours')`,
    [key, ctx.userId, ctx.familyId, requestHash],
  );
  return { kind: "new" };
}

async function finishIdempotency(
  client: PoolClient,
  req: express.Request,
  status: number,
  response: unknown,
): Promise<void> {
  const key = idempotencyKey(req);
  if (key === null) return;
  await client.query(
    "update shopping_domain.idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [key, status, JSON.stringify(response)],
  );
}

async function emitOutbox(
  client: PoolClient,
  type: string,
  aggregateId: string,
  familyId: string,
  actorUserId: string,
  payload: unknown,
): Promise<void> {
  const eventId = crypto.randomUUID();
  await client.query(
    `insert into shopping_domain.outbox_events
      (event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
     values($1,$2,1,$3,$4,$5,now(),$6::jsonb,now())`,
    [eventId, type, aggregateId, familyId, crypto.randomUUID(), JSON.stringify(payload)],
  );
}

async function init(): Promise<void> {
  await pool.query("select 1");
}

app.get("/health/live", (_req, res) => json(res, 200, { status: "ok", service: "service-shopping" }));

app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("select 1");
    json(res, 200, { status: "ready", service: "service-shopping" });
  } catch {
    json(res, 503, { status: "not_ready", service: "service-shopping" });
  }
});

app.get("/api/v1/shopping/lists", async (req, res) => {
  const ctx = requestContext(req);
  if (ctx === null) return fail(res, 400, "VALIDATION_ERROR", "familyId is required.");
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const offset = Math.max(Number(req.query.cursor ?? 0), 0);

  try {
    const result = await pool.query(
      `select l.*, count(i.id)::int as item_count
       from shopping_domain.lists l
       left join shopping_domain.items i on i.list_id=l.id
       where l.family_id=$1
       group by l.id
       order by l.created_at desc
       limit $2 offset $3`,
      [ctx.familyId, limit, offset],
    );
    json(res, 200, {
      items: result.rows.map((row) => toList(row, Number(row.item_count))),
      nextCursor: result.rows.length === limit ? String(offset + limit) : null,
    });
  } catch {
    fail(res, 500, "INTERNAL_ERROR", "Unable to list shopping lists.");
  }
});

app.post("/api/v1/shopping/lists", async (req, res) => {
  const ctx = requestContext(req);
  const body = req.body as Body;
  const key = idempotencyKey(req);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (ctx === null || name.length === 0 || name.length > 120 || key === null) {
    return fail(res, 400, "VALIDATION_ERROR", "familyId, name and X-Idempotency-Key are required.");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, ctx, body);
    if (idem.kind === "conflict") {
      await client.query("rollback");
      return fail(res, 409, "CONFLICT", "Idempotency key conflict.");
    }
    if (idem.kind === "replay") {
      await client.query("commit");
      return json(res, idem.status, idem.response);
    }

    const row = await client.query(
      `insert into shopping_domain.lists(id,family_id,name,status,created_by_user_id)
       values($1,$2,$3,'open',$4) returning *`,
      [crypto.randomUUID(), ctx.familyId, name, ctx.userId],
    );
    const response = { data: toList(row.rows[0]), version: 1 };
    await emitOutbox(client, "ShoppingListCreated", String(row.rows[0].id), ctx.familyId, ctx.userId, response);
    await finishIdempotency(client, req, 201, response);
    await client.query("commit");
    return json(res, 201, response);
  } catch (error) {
    await client.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to create list.");
  } finally {
    client.release();
  }
});

app.get("/api/v1/shopping/lists/:listId", async (req, res) => {
  const ctx = requestContext(req);
  if (ctx === null) return fail(res, 400, "VALIDATION_ERROR", "familyId is required.");
  const q = await pool.query("select * from shopping_domain.lists where id=$1 and family_id=$2", [req.params.listId, ctx.familyId]);
  if (!q.rowCount) return fail(res, 404, "NOT_FOUND", "Shopping list not found.");
  const items = await pool.query("select * from shopping_domain.items where list_id=$1 order by created_at", [req.params.listId]);
  const list = q.rows[0] as Record<string, unknown>;
  return json(res, 200, {
    data: {
      ...toList(list, items.rowCount ?? 0),
      items: items.rows.map((row) => toItem(row as Record<string, unknown>)),
    },
    version: Number(list.version),
  });
});

app.post("/api/v1/shopping/lists/:listId/items", async (req, res) => {
  const ctx = requestContext(req);
  const body = req.body as Body;
  if (ctx === null || idempotencyKey(req) === null) return fail(res, 400, "VALIDATION_ERROR", "familyId and X-Idempotency-Key are required.");
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const quantity = Number(body.quantity);
  const unit = typeof body.unit === "string" ? body.unit : "";
  if (!label || !Number.isFinite(quantity) || quantity <= 0 || !unit) return fail(res, 400, "VALIDATION_ERROR", "label, quantity and unit are required.");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, ctx, body);
    if (idem.kind === "conflict") { await client.query("rollback"); return fail(res,409,"CONFLICT","Idempotency key conflict."); }
    if (idem.kind === "replay") { await client.query("commit"); return json(res,idem.status,idem.response); }
    const list = await client.query("select * from shopping_domain.lists where id=$1 and family_id=$2 for update",[req.params.listId,ctx.familyId]);
    if (!list.rowCount) { await client.query("rollback"); return fail(res,404,"NOT_FOUND","Shopping list not found."); }
    if (list.rows[0].status !== "open") { await client.query("rollback"); return fail(res,422,"BUSINESS_RULE_VIOLATION","Closed shopping lists cannot be modified."); }
    const item = await client.query(`insert into shopping_domain.items(id,list_id,product_id,label,quantity,unit,checked,source) values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [crypto.randomUUID(),req.params.listId,body.productId??null,label,quantity,unit,Boolean(body.checked??false),typeof body.source==="string"?body.source:"manual"]);
    await client.query("update shopping_domain.lists set version=version+1,updated_at=now() where id=$1",[req.params.listId]);
    const response={data:toItem(item.rows[0] as Record<string,unknown>),version:Number(list.rows[0].version)+1};
    await emitOutbox(client,"ShoppingItemAdded",String(item.rows[0].id),ctx.familyId,ctx.userId,response);
    await finishIdempotency(client,req,201,response);await client.query("commit");return json(res,201,response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to add shopping item.");}finally{client.release();}
});

app.patch("/api/v1/shopping/lists/:listId/items/:itemId", async (req,res)=>{
  const ctx=requestContext(req); const body=req.body as Body;
  if(ctx===null||idempotencyKey(req)===null||ifMatch(req)===null)return fail(res,400,"VALIDATION_ERROR","familyId, X-Idempotency-Key and If-Match are required.");
  const client=await pool.connect();
  try{
    await client.query("begin");
    const idem=await beginIdempotency(client,req,ctx,body);
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return json(res,idem.status,idem.response);}
    const current=await client.query(`select i.*,l.version as list_version,l.status as list_status from shopping_domain.items i join shopping_domain.lists l on l.id=i.list_id where i.id=$1 and i.list_id=$2 and l.family_id=$3 for update`,[req.params.itemId,req.params.listId,ctx.familyId]);
    if(!current.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Shopping item not found.");}
    const row=current.rows[0];if(row.list_status!=="open"){await client.query("rollback");return fail(res,422,"BUSINESS_RULE_VIOLATION","Closed shopping lists cannot be modified.");}
    if(Number(row.version)!==ifMatch(req)){await client.query("rollback");return fail(res,412,"PRECONDITION_FAILED","Item version changed.");}
    const label=Object.hasOwn(body,"label")?String(body.label).trim():String(row.label);
    const quantity=Object.hasOwn(body,"quantity")?Number(body.quantity):Number(row.quantity);
    const unit=Object.hasOwn(body,"unit")?String(body.unit):String(row.unit);
    const checked=Object.hasOwn(body,"checked")?body.checked===true:Boolean(row.checked);
    if(!label||!Number.isFinite(quantity)||quantity<=0||!unit){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","Invalid shopping item.");}
    const updated=await client.query(`update shopping_domain.items set label=$2,quantity=$3,unit=$4,checked=$5,updated_at=now(),version=version+1 where id=$1 returning *`,[row.id,label,quantity,unit,checked]);
    await client.query("update shopping_domain.lists set version=version+1,updated_at=now() where id=$1",[req.params.listId]);
    const response={data:toItem(updated.rows[0] as Record<string,unknown>),version:Number(updated.rows[0].version)};
    await emitOutbox(client,"ShoppingItemUpdated",String(row.id),ctx.familyId,ctx.userId,response);await finishIdempotency(client,req,200,response);await client.query("commit");return json(res,200,response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to update shopping item.");}finally{client.release();}
});

app.delete("/api/v1/shopping/lists/:listId/items/:itemId",async(req,res)=>{
  const ctx=requestContext(req); if(ctx===null||idempotencyKey(req)===null||ifMatch(req)===null)return fail(res,400,"VALIDATION_ERROR","familyId, X-Idempotency-Key and If-Match are required.");
  const client=await pool.connect();
  try{
    await client.query("begin");const body={listId:req.params.listId,itemId:req.params.itemId};const idem=await beginIdempotency(client,req,ctx,body);
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).end();}
    const current=await client.query(`select i.*,l.version as list_version,l.status as list_status from shopping_domain.items i join shopping_domain.lists l on l.id=i.list_id where i.id=$1 and i.list_id=$2 and l.family_id=$3 for update`,[req.params.itemId,req.params.listId,ctx.familyId]);
    if(!current.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Shopping item not found.");}
    if(current.rows[0].list_status!=="open"){await client.query("rollback");return fail(res,422,"BUSINESS_RULE_VIOLATION","Closed shopping lists cannot be modified.");}
    if(Number(current.rows[0].version)!==ifMatch(req)){await client.query("rollback");return fail(res,412,"PRECONDITION_FAILED","Item version changed.");}
    await client.query("delete from shopping_domain.items where id=$1",[req.params.itemId]);await client.query("update shopping_domain.lists set version=version+1,updated_at=now() where id=$1",[req.params.listId]);
    await emitOutbox(client,"ShoppingItemRemoved",req.params.itemId,ctx.familyId,ctx.userId,body);await finishIdempotency(client,req,204,null);await client.query("commit");return res.status(204).end();
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to delete shopping item.");}finally{client.release();}
});

app.post("/api/v1/shopping/lists/:listId/close",async(req,res)=>{
  const ctx=requestContext(req);if(ctx===null||idempotencyKey(req)===null)return fail(res,400,"VALIDATION_ERROR","familyId and X-Idempotency-Key are required.");
  const client=await pool.connect();
  try{
    await client.query("begin");const body={listId:req.params.listId};const idem=await beginIdempotency(client,req,ctx,body);
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return json(res,idem.status,idem.response);}
    const q=await client.query("update shopping_domain.lists set status='closed',version=version+1,updated_at=now() where id=$1 and family_id=$2 and status='open' returning *",[req.params.listId,ctx.familyId]);
    if(!q.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Open shopping list not found.");}
    const response={data:toList(q.rows[0] as Record<string,unknown>),version:Number(q.rows[0].version)};
    await emitOutbox(client,"ShoppingListClosed",req.params.listId,ctx.familyId,ctx.userId,response);await finishIdempotency(client,req,200,response);await client.query("commit");return json(res,200,response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to close list.");}finally{client.release();}
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));

init().then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-shopping",port}))))
  .catch((error)=>{console.error(error);process.exit(1);});
