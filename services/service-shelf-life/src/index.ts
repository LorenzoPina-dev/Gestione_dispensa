import { isBoolean, isConfidence, isPredictionStatus, isStorage } from "./validation.js";
import express, { type Request, type Response as ExpressResponse } from "express";
import { createContextAwarePool, setDbRequestContextFromHeaders, type PoolClient } from "@gestione-dispensa/runtime-db/postgres-client.js";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => { setDbRequestContextFromHeaders(req.headers); next(); });

const port = Number(process.env.PORT ?? 3404);
const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
const familyServiceBaseUrl = (process.env.FAMILY_SERVICE_BASE_URL ?? "http://service-family:3311/api/v1").replace(/\/$/, "");
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";

type Storage = "PANTRY" | "FRIDGE" | "FREEZER" | "CELLAR" | "OTHER";
type PredictionStatus = "queued" | "completed" | "applied" | "superseded" | "failed";
type Body = Record<string, unknown>;

const fail = (res: ExpressResponse, status: number, code: string, message: string): ExpressResponse => {
  const requestId=crypto.randomUUID();
  return res.status(status).json({
    error:{code,message,details:[],retryable:status>=502,requestId},
    meta:{requestId,traceId:requestId,schemaVersion:"1.0"},
  });
};

function actor(req: Request): string {
  return String(req.header("x-user-id") ?? "").trim();
}
async function authorizeFamily(userId: string, familyId: string, write: boolean): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  try {
    const response = await fetch(`${familyServiceBaseUrl}/families/${encodeURIComponent(familyId)}/members`, { headers: { "x-user-id": userId, accept: "application/json" }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." };
    const payload = await response.json() as { items?: Array<{ userId: string; role: string; status: string }> };
    const member = payload.items?.find((item) => item.userId === userId);
    if (!member || member.status !== "ACTIVE") return { ok: false, status: 403, code: "FORBIDDEN", message: "User is not an active member of the family." };
    if (write && member.role === "viewer") return { ok: false, status: 403, code: "FORBIDDEN", message: "Viewer role is read-only." };
    return { ok: true };
  } catch { return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." }; }
}

function familyContext(req: Request): string | null {
  return String(req.header("x-family-id") ?? req.query.familyId ?? req.body?.familyId ?? "").trim() || null;
}

function requireInternal(req: Request, res: ExpressResponse): boolean {
  if (!internalServiceToken) {
    fail(res, 503, "SERVICE_UNAVAILABLE", "Internal service authentication is not configured.");
    return false;
  }
  if (req.header("authorization") !== `Bearer ${internalServiceToken}`) {
    fail(res, 401, "UNAUTHENTICATED", "Internal service authentication is required.");
    return false;
  }
  return true;
}

function key(req: Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
}

function normalizeStorage(value: unknown): Storage | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["fridge", "frigo", "frigorifero"].includes(raw)) return "FRIDGE";
  if (["freezer", "congelatore"].includes(raw)) return "FREEZER";
  if (["pantry", "dispensa"].includes(raw)) return "PANTRY";
  if (["cellar", "cantina"].includes(raw)) return "CELLAR";
  if (["other", "altro"].includes(raw)) return "OTHER";
  return null;
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function beginIdempotency(client: PoolClient, req: Request, body: unknown, userId: string) {
  const idempotencyKey = key(req);
  if (!idempotencyKey) return { kind: "missing" as const };

  const requestHash = hash(body);
  const existing = await client.query(
    "select actor_user_id,request_hash,status,response_status,response_body from shelf_life_domain.idempotency_keys where key=$1 for update",
    [idempotencyKey],
  );

  if (existing.rowCount) {
    const row = existing.rows[0];
    if (String(row.actor_user_id) !== userId || row.request_hash !== requestHash) {
      return { kind: "conflict" as const };
    }
    if (row.status === "completed") {
      return {
        kind: "replay" as const,
        status: Number(row.response_status),
        response: row.response_body,
      };
    }
    return { kind: "new" as const };
  }

  await client.query(
    `insert into shelf_life_domain.idempotency_keys
      (key,actor_user_id,family_id,request_hash,status,created_at,expires_at)
     values($1,$2,null,$3,'processing',now(),now()+interval '24 hours')`,
    [idempotencyKey, userId, requestHash],
  );
  return { kind: "new" as const };
}

async function finishIdempotency(client: PoolClient, req: Request, status: number, response: unknown) {
  const idempotencyKey = key(req);
  if (!idempotencyKey) return;
  await client.query(
    "update shelf_life_domain.idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [idempotencyKey, status, JSON.stringify(response)],
  );
}

async function emitOutbox(
  client: PoolClient,
  type: string,
  aggregateId: string,
  familyId: string | null,
  payload: unknown,
) {
  await client.query(
    `insert into shelf_life_domain.outbox_events
      (event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
     values($1,$2,1,$3,$4,$5,now(),$6::jsonb,now())`,
    [crypto.randomUUID(), type, aggregateId, familyId, crypto.randomUUID(), JSON.stringify(toEventPayload(payload))],
  );
}

type ShelfLifeRule = {
  id: string;
  product_id?: string | null;
  product_category: string | null;
  storage: Storage;
  opened: boolean;
  min_days: number;
  target_days: number | null;
  max_days: number;
  model_version: string;
  active: boolean;
};

async function ruleFor(
  category: string | null,
  productId: string,
  storage: Storage,
  opened: boolean,
): Promise<ShelfLifeRule | undefined> {
  const product = await pool.query<ShelfLifeRule>(
    `select id,product_id,null::varchar as product_category,storage,opened,min_days,target_days,max_days,model_version,active
     from shelf_life_domain.product_profiles
     where active=true and product_id=$1 and storage=$2 and opened=$3
     order by created_at desc
     limit 1`,
    [productId, storage, opened],
  );
  if (product.rows[0]) return product.rows[0];

  if (category) {
    const specific = await pool.query<ShelfLifeRule>(
      `select id,null::uuid as product_id,product_category,storage,opened,min_days,target_days,max_days,model_version,active
       from shelf_life_domain.rules
       where active=true and product_category=$1 and storage=$2 and opened=$3
       order by created_at desc
       limit 1`,
      [category, storage, opened],
    );
    if (specific.rows[0]) return specific.rows[0];

    // A recognized category with an incompatible storage condition must fail closed;
    // it must not silently become an unrelated generic estimate.
    const known = await pool.query<{ id: string }>(
      `select id from shelf_life_domain.rules where active=true and product_category=$1 limit 1`,
      [category],
    );
    if (known.rows[0]) return undefined;
  }

  const generic = await pool.query<ShelfLifeRule>(
    `select id,null::uuid as product_id,product_category,storage,opened,min_days,target_days,max_days,model_version,active
     from shelf_life_domain.rules
     where active=true and product_category is null and storage=$1 and opened=$2
     order by created_at desc
     limit 1`,
    [storage, opened],
  );
  return generic.rows[0];
}

function confidenceFor(rule: Pick<ShelfLifeRule, "min_days" | "max_days" | "product_category" | "product_id">): number {
  const productBonus = rule.product_id ? 0.08 : 0;
  const categoryBonus = rule.product_category ? 0.12 : 0;
  const rangePenalty = Math.min(0.2, Math.max(0, (rule.max_days - rule.min_days) / 500));
  return Math.max(0.5, Math.min(0.98, 0.76 + productBonus + categoryBonus - rangePenalty));
}

function parseOptionalIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function toEventPayload(payload: unknown): unknown {
  if (typeof payload === "object" && payload !== null && Object.hasOwn(payload as object, "data")) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

async function init(): Promise<void> {
  await pool.query("select 1");
}


app.get("/health/live", (_req,res) => res.json({ status:"ok", service:"service-shelf-life" }));
app.get("/health/ready", async (_req,res) => {
  try { await pool.query("select 1"); res.json({ status:"ready",service:"service-shelf-life" }); }
  catch { res.status(503).json({ status:"not_ready",service:"service-shelf-life" }); }
});

app.post("/api/v1/shelf-life/predictions", async (req,res) => {
  const userId = actor(req);
  const body = req.body as Body;
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const productId = typeof body.productId === "string" ? body.productId : "";
  const storage = normalizeStorage(body.storedAt);
  const opened = body.opened;
  const familyId = familyContext(req);
  const storedOn = parseOptionalIsoDate(body.storedOn);

  if (!userId) return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  if (body.storedOn !== undefined && storedOn === undefined) return fail(res,400,"VALIDATION_ERROR","storedOn is invalid.");
  if (!itemId || !productId || !familyId || storage === null || typeof opened !== "boolean" || !key(req)) {
    return fail(res,400,"VALIDATION_ERROR","itemId, productId, familyId, storedAt, opened and X-Idempotency-Key are required.");
  }
  const familyAccess = await authorizeFamily(userId, familyId, true); if (!familyAccess.ok) return fail(res, familyAccess.status, familyAccess.code, familyAccess.message);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client,req,body,userId);
    if (idem.kind === "missing") { await client.query("rollback"); return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required."); }
    if (idem.kind === "conflict") { await client.query("rollback"); return fail(res,409,"CONFLICT","Idempotency key conflict."); }
    if (idem.kind === "replay") { await client.query("commit"); return res.status(idem.status).json(idem.response); }

    const latest = await client.query(
      "select id,status,version from shelf_life_domain.predictions where item_id=$1 and user_id=$2 and family_id=$3 and status in ('queued','completed','applied') order by created_at desc limit 1 for update",
      [itemId,userId,familyId],
    );
    if (latest.rowCount && latest.rows[0].status === "queued") {
      const response = { data: { predictionId: latest.rows[0].id, status: "queued" }, version: Number(latest.rows[0].version) };
      await finishIdempotency(client,req,202,response); await client.query("commit"); return res.status(202).json(response);
    }

    const predictionId = crypto.randomUUID();
    const response = { data: { predictionId, status: "queued" }, version: 1 };
    await client.query(
      `insert into shelf_life_domain.predictions(id,user_id,family_id,item_id,product_id,storage,opened,category,stored_on,estimated_expires_at,confidence,basis,model_version,status)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,null,0,'pending','pending','queued')`,
      [predictionId,userId,familyId,itemId,productId,storage,opened,typeof body.category==="string"?body.category.trim().toLowerCase():null,storedOn ?? null],
    );
    await emitOutbox(client,"shelf-life.prediction-queued.v1",predictionId,familyId,{predictionId,itemId,productId,storage,opened,category:typeof body.category==="string"?body.category:null,storedOn:storedOn ?? null,userId});
    await finishIdempotency(client,req,202,response);
    await client.query("commit");


    return res.status(202).json(response);
  } catch (error) {
    await client.query("rollback");
    return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to queue prediction.");
  } finally { client.release(); }
});

app.get("/api/v1/internal/shelf-life/predictions/recoverable", async (req,res) => {
  if (!requireInternal(req,res)) return;
  const parsedLimit = Number(req.query.limit ?? 50);
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
  try {
    const q = await pool.query(
      `select id,item_id,product_id,storage,opened,category,stored_on,user_id,family_id,status
       from shelf_life_domain.predictions
       where status = 'queued'
       order by created_at asc
       limit $1`,
      [limit],
    );
    return res.json({
      data: q.rows.map((row) => ({
        predictionId: row.id,
        itemId: row.item_id,
        productId: row.product_id,
        storage: row.storage,
        opened: row.opened === true,
        category: row.category ?? null,
        storedOn: row.stored_on ?? null,
        userId: row.user_id,
        familyId: row.family_id,
        status: row.status,
      })),
    });
  } catch {
    return fail(res,500,"INTERNAL_ERROR","Unable to recover queued shelf-life predictions.");
  }
});

app.post("/api/v1/internal/shelf-life/predictions/:predictionId/process", async (req,res) => {
  if (!requireInternal(req,res)) return;
  const id = req.params.predictionId;
  const body = req.body as Body;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select * from shelf_life_domain.predictions where id=$1 for update",
      [id],
    );
    if (!current.rowCount) { await client.query("rollback"); return fail(res,404,"NOT_FOUND","Prediction not found."); }
    const stored = current.rows[0];
    if (stored.status === "applied") { await client.query("commit"); return res.status(200).json({ data: stored }); }
    if (stored.status === "completed") { await client.query("commit"); return res.status(200).json({ data: stored, version: Number(stored.version) }); }
    if (stored.status === "superseded") { await client.query("rollback"); return fail(res,409,"CONFLICT","Shelf-life prediction has been superseded."); }

    const storage = normalizeStorage(body.storedAt ?? body.storage ?? stored.storage);
    const opened = typeof body.opened === "boolean" ? body.opened : stored.opened === true;
    const category = typeof body.category === "string" ? body.category.trim().toLowerCase() : (typeof stored.category === "string" ? stored.category : null);
    const storedOn = parseOptionalIsoDate(body.storedOn) ?? parseOptionalIsoDate(stored.stored_on);
    if (storage === null) { await client.query("rollback"); return fail(res,400,"VALIDATION_ERROR","storedAt is invalid."); }
    if (body.storedOn !== undefined && parseOptionalIsoDate(body.storedOn) === undefined) { await client.query("rollback"); return fail(res,400,"VALIDATION_ERROR","storedOn is invalid."); }

    const rule = await ruleFor(category,String(current.rows[0].product_id),storage,opened);
    if (!rule) {
      await client.query(
        "update shelf_life_domain.predictions set status='failed',basis='no_matching_rule',model_version='none',updated_at=now(),version=version+1 where id=$1",
        [id],
      );
      await client.query("commit");
      return fail(res,422,"PREDICTION_UNAVAILABLE","No active shelf-life rule matches the requested product/storage state.");
    }

    const confidence = confidenceFor(rule);
    const minDays = Number(rule.min_days);
    const maxDays = Number(rule.max_days);
    const targetDays = rule.target_days == null
      ? (minDays === maxDays ? minDays : Math.round((minDays + maxDays) / 2))
      : Number(rule.target_days);
    const expires = new Date(storedOn ?? new Date().toISOString());
    expires.setUTCDate(expires.getUTCDate() + targetDays);

    const q = await client.query(
      `update shelf_life_domain.predictions
       set category=coalesce($6,category),
           estimated_expires_at=$2,
           confidence=$3,
           basis=$4,
           model_version=$5,
           status='completed',
           updated_at=now(),
           version=version+1
       where id=$1 returning *`,
      [id,expires.toISOString(),confidence,`${rule.product_id ? "product:" + rule.product_id + "+" : ""}${category ? "category:" + category : "category:unknown"}+storage:${storage}+opened:${opened}+target_days:${targetDays}`,rule.model_version,category],
    );
    await emitOutbox(client,"shelf-life.prediction-completed.v1",id,current.rows[0].family_id ?? null,{
      predictionId:id,
      itemId:current.rows[0].item_id,
      productId:current.rows[0].product_id,
      estimatedExpiresAt:expires.toISOString(),
      confidence,
      modelVersion:rule.model_version,
    });
    await client.query("commit");
    return res.status(200).json({ data: q.rows[0], version: q.rows[0].version });
  } catch (error) {
    await client.query("rollback");
    return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to process prediction.");
  } finally { client.release(); }
});

app.get("/api/v1/shelf-life/predictions/:predictionId", async (req,res) => {
  const userId=actor(req); if(!userId)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  const q=await pool.query("select id,item_id,product_id,estimated_expires_at,confidence,basis,model_version,status,version from shelf_life_domain.predictions where id=$1 and user_id=$2",[req.params.predictionId,userId]);
  if(!q.rowCount)return fail(res,404,"NOT_FOUND","Prediction not found.");
  const x=q.rows[0];
  return res.json({data:{
    predictionId:x.id,itemId:x.item_id,estimatedExpiresAt:x.estimated_expires_at,
    confidence:Number(x.confidence),basis:x.basis,status:x.status
  }});
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));

async function main() {
  await init();
  app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-shelf-life",port})));
}
main().catch((error)=>{console.error(error);process.exit(1)});
