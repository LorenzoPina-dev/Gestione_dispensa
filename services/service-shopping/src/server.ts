import express from "express";
import { createContextAwarePool, setDbRequestContextFromHeaders, type PoolClient } from "@gestione-dispensa/runtime-db/postgres-client.js";
import crypto from "node:crypto";
import { isOptionalUuid, isShoppingSource, isShoppingUnit, normalizeListName, parseIfMatch, positiveQuantity, validFamilyId, validIdempotencyKey } from "./validation.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => { setDbRequestContextFromHeaders(req.headers); next(); });

const port = Number(process.env.PORT ?? 3313);
const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
function normalizeFamilyServiceBaseUrl(value: string | undefined): string {
  const base = (value ?? "http://service-family:3311").replace(/\/$/, "");
  return base.endsWith("/api/v1") ? base : base + "/api/v1";
}

const familyServiceBaseUrl = normalizeFamilyServiceBaseUrl(process.env.FAMILY_SERVICE_BASE_URL);

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
  const retryable = new Set(["FAMILY_AUTH_UNAVAILABLE","UPSTREAM_ERROR","SERVICE_UNAVAILABLE","INTERNAL_ERROR"]).has(code);
  const requestId = crypto.randomUUID();
  json(res, status, {
    error: { code, message, details, retryable, requestId },
    meta: { requestId, traceId: crypto.randomUUID(), schemaVersion: "1.0" },
  });
};

type RequestContext = {
  userId: string;
  familyId: string;
  requestId: string;
  correlationId: string;
  causationId: string | null;
};

function requestContext(req: express.Request): RequestContext | null {
  const userId = String(req.header("x-user-id") ?? "").trim();
  const familyId = String(req.query.familyId ?? req.body?.familyId ?? req.header("x-family-id") ?? "").trim();
  if (!userId || !validFamilyId(familyId)) return null;
  return {
    userId,
    familyId,
    requestId: String(req.header("x-request-id") ?? crypto.randomUUID()),
    correlationId: String(req.header("x-correlation-id") ?? crypto.randomUUID()),
    causationId: req.header("x-causation-id") ?? null,
  };
}

async function authorizeFamily(ctx: { userId: string; familyId: string }, write: boolean): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  try {
    const response = await fetch(`${familyServiceBaseUrl}/families/${encodeURIComponent(ctx.familyId)}/members`, {
      headers: { "x-user-id": ctx.userId, accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." };
    const payload = await response.json() as { items?: Array<{ userId: string; role: string; status: string }> };
    const member = payload.items?.find((item) => item.userId === ctx.userId);
    if (!member || member.status !== "ACTIVE") return { ok: false, status: 403, code: "FORBIDDEN", message: "User is not an active member of the family." };
    if (write && member.role === "viewer") return { ok: false, status: 403, code: "FORBIDDEN", message: "Viewer role is read-only." };
    return { ok: true };
  } catch {
    return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." };
  }
}
function idempotencyKey(req: express.Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return validIdempotencyKey(value) ? value : null;
}

function ifMatch(req: express.Request): number | null {
  return parseIfMatch(req.header("if-match") ?? "") ?? null;
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
  ctx: RequestContext,
  payload: unknown,
): Promise<void> {
  const eventId = crypto.randomUUID();
  await client.query(
    `insert into shopping_domain.outbox_events
      (event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,causation_id,occurred_at,payload,created_at)
     values($1,$2,1,$3,$4,$5,$6,now(),$7::jsonb,now())`,
    [eventId, type, aggregateId, ctx.familyId, ctx.correlationId, ctx.causationId, JSON.stringify(toEventPayload(payload))],
  );
}

function toEventPayload(payload: unknown): unknown {
  if (typeof payload === "object" && payload !== null && Object.hasOwn(payload as object, "data")) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function toList(row: Record<string, unknown>, itemCount?: number): Record<string, unknown> {
  return {
    listId: String(row.id),
    name: String(row.name),
    status: String(row.status),
    itemCount: itemCount ?? Number(row.item_count ?? 0),
    version: Number(row.version),
  };
}

function toSuggestion(row: Record<string, unknown>): Record<string, unknown> {
  return {
    suggestionId: String(row.id),
    productId: String(row.product_id),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    reorderPoint: Number(row.reorder_point),
    status: String(row.status),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function toItem(row: Record<string, unknown>): Record<string, unknown> {
  return {
    itemId: String(row.id),
    productId: row.product_id === null || row.product_id === undefined ? null : String(row.product_id),
    source: row.source === null || row.source === undefined ? "manual" : String(row.source),
    label: String(row.label),
    quantity: Number(row.quantity),
    unit: row.unit === null || row.unit === undefined ? null : String(row.unit),
    checked: Boolean(row.checked),
    version: Number(row.version),
  };
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

app.get("/api/v1/shopping/suggestions", async (req, res) => {
  const ctx = requestContext(req);
  if (ctx === null) return fail(res, 400, "VALIDATION_ERROR", "familyId is required.");
  const access = await authorizeFamily(ctx, false);
  if (!access.ok) return fail(res, access.status, access.code, access.message);
  const status = String(req.query.status ?? "active");
  if (status !== "active" && status !== "resolved") return fail(res, 400, "VALIDATION_ERROR", "status must be active or resolved.");
  try {
    const result = await pool.query("select * from shopping_domain.reorder_suggestions where family_id=$1 and status=$2 order by updated_at desc limit 100", [ctx.familyId, status]);
    return json(res, 200, { items: result.rows.map(toSuggestion), nextCursor: null });
  } catch {
    return fail(res, 500, "INTERNAL_ERROR", "Unable to list reorder suggestions.");
  }
});
app.get("/api/v1/shopping/lists", async (req, res) => {
  const ctx = requestContext(req);
  if (ctx === null) return fail(res, 400, "VALIDATION_ERROR", "familyId is required.");
  const access = await authorizeFamily(ctx, req.method !== "GET" && req.method !== "HEAD");
  if (!access.ok) return fail(res, access.status, access.code, access.message);

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
      items: (result.rows.length>limit?result.rows.slice(0,limit):result.rows).map((row) => toList(row, Number(row.item_count))),
      nextCursor: result.rows.length>limit ? String(offset + limit) : null,
    });
  } catch {
    fail(res, 500, "INTERNAL_ERROR", "Unable to list shopping lists.");
  }
});

app.post("/api/v1/shopping/lists", async (req, res) => {
  const ctx = requestContext(req);
  const body = req.body as Body;
  const key = idempotencyKey(req);
  const name = normalizeListName(body.name);
  if (ctx === null || name.length === 0 || name.length > 120 || key === null) {
    return fail(res, 400, "VALIDATION_ERROR", "familyId, name and X-Idempotency-Key are required.");
  }
  const access = await authorizeFamily(ctx, true);
  if (!access.ok) return fail(res, access.status, access.code, access.message);

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
    await emitOutbox(client, "ShoppingListCreated", String(row.rows[0].id), ctx, response);
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
  const access = await authorizeFamily(ctx, false);
  if (!access.ok) return fail(res, access.status, access.code, access.message);
  const q = await pool.query("select * from shopping_domain.lists where id=$1 and family_id=$2", [req.params.listId, ctx.familyId]);
  if (!q.rowCount) return fail(res, 404, "NOT_FOUND", "Shopping list not found.");
  const items = await pool.query("select * from shopping_domain.items where list_id=$1 order by created_at", [req.params.listId]);
  const list = q.rows[0] as Record<string, unknown>;
  return json(res, 200, {
    data: {
      listId: String(list.id),
      name: String(list.name),
      status: String(list.status),
      items: items.rows.map((row) => toItem(row as Record<string, unknown>)),
      version: Number(list.version),
    },
    version: Number(list.version),
  });
});

app.post("/api/v1/shopping/lists/:listId/items", async (req, res) => {
  const ctx = requestContext(req);
  const body = req.body as Body;
  if (ctx) {
    const access = await authorizeFamily(ctx, true);
    if (!access.ok) return fail(res, access.status, access.code, access.message);
  }
  if (ctx === null || idempotencyKey(req) === null) return fail(res, 400, "VALIDATION_ERROR", "familyId and X-Idempotency-Key are required.");
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const quantity = positiveQuantity(body.quantity);
  const unit = typeof body.unit === "string" ? body.unit : "";
  if (!label || quantity === undefined || !isShoppingUnit(unit)) return fail(res, 400, "VALIDATION_ERROR", "label, quantity and unit are required.");
  if (!isOptionalUuid(body.productId)) return fail(res, 400, "VALIDATION_ERROR", "productId must be a UUID.");
  if (body.source !== undefined && !isShoppingSource(body.source)) return fail(res, 400, "VALIDATION_ERROR", "source must be manual, recipe, low_stock or offer.");

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
    const response={data:toItem(item.rows[0] as Record<string,unknown>),version:Number(item.rows[0].version)};
    await emitOutbox(client, "ShoppingItemAdded", String(item.rows[0].id), ctx, response);
    await finishIdempotency(client,req,201,response);await client.query("commit");return json(res,201,response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to add shopping item.");}finally{client.release();}
});

app.patch("/api/v1/shopping/lists/:listId/items/batch", async (req,res)=>{
  const ctx = requestContext(req);
  const body = req.body as Body;
  const items = Array.isArray(body.items) ? body.items : [];
  if (ctx === null || idempotencyKey(req) === null) {
    return fail(res, 400, "VALIDATION_ERROR", "familyId, X-Idempotency-Key are required.");
  }
  if (items.length < 1 || items.length > 100 || items.some((item) =>
    !item || typeof item !== "object" ||
    typeof (item as Record<string, unknown>).itemId !== "string" ||
    !Number.isInteger((item as Record<string, unknown>).version) ||
    typeof (item as Record<string, unknown>).checked !== "boolean"
  )) {
    return fail(res, 400, "VALIDATION_ERROR", "items must contain 1-100 {itemId,version,checked} entries.");
  }
  const access = await authorizeFamily(ctx, true);
  if (!access.ok) return fail(res, access.status, access.code, access.message);

  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, ctx, body);
    if (idem.kind === "conflict") { await client.query("rollback"); return fail(res, 409, "CONFLICT", "Idempotency key conflict."); }
    if (idem.kind === "replay") { await client.query("commit"); return json(res, idem.status, idem.response); }

    const list = await client.query("select * from shopping_domain.lists where id=$1 and family_id=$2 for update", [req.params.listId, ctx.familyId]);
    if (!list.rowCount) { await client.query("rollback"); return fail(res, 404, "NOT_FOUND", "Shopping list not found."); }
    if (list.rows[0].status !== "open") { await client.query("rollback"); return fail(res, 422, "BUSINESS_RULE_VIOLATION", "Closed shopping lists cannot be modified."); }

    const updated: Record<string, unknown>[] = [];
    for (const input of items as Array<Record<string, unknown>>) {
      const current = await client.query(
        "select * from shopping_domain.items where id=$1 and list_id=$2 for update",
        [String(input.itemId), req.params.listId],
      );
      if (!current.rowCount) {
        await client.query("rollback");
        return fail(res, 404, "NOT_FOUND", `Shopping item ${String(input.itemId)} not found.`);
      }
      const row = current.rows[0] as Record<string, unknown>;
      if (Number(row.version) !== Number(input.version)) {
        await client.query("rollback");
        return fail(res, 412, "PRECONDITION_FAILED", `Shopping item ${String(input.itemId)} changed.`);
      }
      const changed = await client.query(
        "update shopping_domain.items set checked=$2,updated_at=now(),version=version+1 where id=$1 returning *",
        [row.id, input.checked === true],
      );
      const dto = toItem(changed.rows[0] as Record<string, unknown>);
      updated.push(dto);
      await emitOutbox(client, "ShoppingItemUpdated", String(row.id), ctx, { data: dto });
    }
    await client.query("update shopping_domain.lists set version=version+$2,updated_at=now() where id=$1", [req.params.listId, updated.length]);
    const response = { data: { updated }, version: Number(list.rows[0].version) + updated.length };
    await finishIdempotency(client, req, 200, response);
    await client.query("commit");
    return json(res, 200, response);
  } catch (error) {
    await client.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to update shopping items.");
  } finally {
    client.release();
  }
});

app.patch("/api/v1/shopping/lists/:listId/items/:itemId", async (req,res)=>{
  const ctx=requestContext(req); const body=req.body as Body;
  if (ctx) {
    const access = await authorizeFamily(ctx, true);
    if (!access.ok) return fail(res, access.status, access.code, access.message);
  }
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
    const quantity=Object.hasOwn(body,"quantity")?positiveQuantity(body.quantity):Number(row.quantity);
    const unit=Object.hasOwn(body,"unit")?String(body.unit):String(row.unit);
    const checked=Object.hasOwn(body,"checked")?body.checked===true:Boolean(row.checked);
    if(!label||quantity===undefined||!isShoppingUnit(unit)){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","Invalid shopping item.");}
    const updated=await client.query(`update shopping_domain.items set label=$2,quantity=$3,unit=$4,checked=$5,updated_at=now(),version=version+1 where id=$1 returning *`,[row.id,label,quantity,unit,checked]);
    await client.query("update shopping_domain.lists set version=version+1,updated_at=now() where id=$1",[req.params.listId]);
    const response={data:toItem(updated.rows[0] as Record<string,unknown>),version:Number(updated.rows[0].version)};
    await emitOutbox(client, "ShoppingItemUpdated", String(row.id), ctx, response);await finishIdempotency(client,req,200,response);await client.query("commit");return json(res,200,response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to update shopping item.");}finally{client.release();}
});

app.delete("/api/v1/shopping/lists/:listId/items/:itemId",async(req,res)=>{
  const ctx=requestContext(req);
  if (ctx) {
    const access = await authorizeFamily(ctx, true);
    if (!access.ok) return fail(res, access.status, access.code, access.message);
  }
  if(ctx===null||idempotencyKey(req)===null||ifMatch(req)===null)return fail(res,400,"VALIDATION_ERROR","familyId, X-Idempotency-Key and If-Match are required.");
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
    await emitOutbox(client, "ShoppingItemRemoved", req.params.itemId, ctx, body);await finishIdempotency(client,req,204,null);await client.query("commit");return res.status(204).end();
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to delete shopping item.");}finally{client.release();}
});

app.post("/api/v1/shopping/lists/:listId/close",async(req,res)=>{
  const ctx=requestContext(req);
  if (ctx) {
    const access = await authorizeFamily(ctx, true);
    if (!access.ok) return fail(res, access.status, access.code, access.message);
  }
  if(ctx===null||idempotencyKey(req)===null)return fail(res,400,"VALIDATION_ERROR","familyId and X-Idempotency-Key are required.");
  const client=await pool.connect();
  try{
    await client.query("begin");const body={listId:req.params.listId};const idem=await beginIdempotency(client,req,ctx,body);
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return json(res,idem.status,idem.response);}
    const q=await client.query("update shopping_domain.lists set status='closed',version=version+1,updated_at=now() where id=$1 and family_id=$2 and status='open' returning *",[req.params.listId,ctx.familyId]);
    if(!q.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Open shopping list not found.");}
    const response={data:toList(q.rows[0] as Record<string,unknown>),version:Number(q.rows[0].version)};
    await emitOutbox(client, "ShoppingListClosed", req.params.listId, ctx, response);await finishIdempotency(client,req,200,response);await client.query("commit");return json(res,200,response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to close list.");}finally{client.release();}
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));

init().then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-shopping",port}))))
  .catch((error)=>{console.error(error);process.exit(1);});
