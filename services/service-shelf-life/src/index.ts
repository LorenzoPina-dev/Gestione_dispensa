import express, { type Request, type Response } from "express";
import { Pool, type PoolClient } from "pg";
import { createClient } from "redis";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT ?? 3404);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";
const queue = "q:shelf-life-prediction";

type Storage = "PANTRY" | "FRIDGE" | "FREEZER" | "CELLAR" | "OTHER";
type PredictionStatus = "queued" | "completed" | "applied" | "superseded" | "failed";
type Body = Record<string, unknown>;

const fail = (res: Response, status: number, code: string, message: string): Response =>
  res.status(status).json({
    error: { code, message, details: [], requestId: crypto.randomUUID() },
  });

function actor(req: Request): string {
  return String(req.header("x-user-id") ?? "").trim();
}

function familyContext(req: Request): string | null {
  return String(req.header("x-family-id") ?? req.query.familyId ?? req.body?.familyId ?? "").trim() || null;
}

function requireInternal(req: Request, res: Response): boolean {
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

function normalizeStorage(value: unknown): Storage {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["fridge", "frigo", "frigorifero"].includes(raw)) return "FRIDGE";
  if (["freezer", "congelatore"].includes(raw)) return "FREEZER";
  if (["pantry", "dispensa"].includes(raw)) return "PANTRY";
  if (["cellar", "cantina"].includes(raw)) return "CELLAR";
  return "OTHER";
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

async function ruleFor(category: string | null, storage: Storage, opened: boolean) {
  const result = await pool.query(
    `select id,product_category,storage,opened,min_days,max_days,model_version,active
     from shelf_life_domain.rules
     where active=true
       and storage=$2
       and opened=$3
       and (product_category=$1 or product_category is null)
     order by case when product_category=$1 then 0 else 1 end
     limit 1`,
    [category, storage, opened],
  );
  return result.rows[0] as
    | {
        id: string;
        product_category: string | null;
        storage: Storage;
        opened: boolean;
        min_days: number;
        max_days: number;
        model_version: string;
        active: boolean;
      }
    | undefined;
}

function confidenceFor(rule: { min_days: number; max_days: number; product_category: string | null }): number {
  const categoryBonus = rule.product_category ? 0.1 : 0;
  const rangePenalty = Math.min(0.15, Math.max(0, (rule.max_days - rule.min_days) / 500));
  return Math.max(0.5, Math.min(0.99, 0.75 + categoryBonus - rangePenalty));
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

  if (!userId) return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  if (!itemId || !productId || !familyId || typeof body.storedAt !== "string" || typeof opened !== "boolean" || !key(req)) {
    return fail(res,400,"VALIDATION_ERROR","itemId, productId, familyId, storedAt, opened and X-Idempotency-Key are required.");
  }

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
      `insert into shelf_life_domain.predictions(id,user_id,family_id,item_id,product_id,estimated_expires_at,confidence,basis,model_version,status)
       values($1,$2,$3,$4,now(),0,'pending','pending','queued')`,
      [predictionId,userId,familyId,itemId,productId],
    );
    await emitOutbox(client,"ShelfLifePredictionQueued",predictionId,familyId,{predictionId,itemId,productId,storage,opened,category:typeof body.category==="string"?body.category:null});
    await finishIdempotency(client,req,202,response);
    await client.query("commit");

    try {
      await redis.connect().catch(() => undefined);
      if (redis.isOpen) {
        await redis.lPush(queue,JSON.stringify({data:{predictionId,itemId,productId,storage,opened,category:typeof body.category==="string"?body.category:null}}));
      }
    } catch { /* durable queued prediction remains */ }

    return res.status(202).json(response);
  } catch (error) {
    await client.query("rollback");
    return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to queue prediction.");
  } finally { client.release(); }
});

app.post("/api/v1/internal/shelf-life/predictions/:predictionId/process", async (req,res) => {
  if (!requireInternal(req,res)) return;
  const id = req.params.predictionId;
  const body = req.body as Body;
  const storage = normalizeStorage(body.storedAt ?? body.storage);
  const opened = body.opened === true;
  const category = typeof body.category === "string" ? body.category.trim().toLowerCase() : null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query(
      "select * from shelf_life_domain.predictions where id=$1 for update",
      [id],
    );
    if (!current.rowCount) { await client.query("rollback"); return fail(res,404,"NOT_FOUND","Prediction not found."); }
    if (current.rows[0].status === "applied") { await client.query("commit"); return res.status(200).json({ data: current.rows[0] }); }

    const rule = await ruleFor(category,storage,opened);
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
    const estimatedDays = minDays === maxDays ? minDays : Math.round((minDays + maxDays) / 2);
    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + estimatedDays);

    const q = await client.query(
      `update shelf_life_domain.predictions
       set estimated_expires_at=$2,confidence=$3,basis=$4,model_version=$5,status='completed',updated_at=now(),version=version+1
       where id=$1 returning *`,
      [id,expires.toISOString(),confidence,`product_category+storage+opened:${storage}:${opened}`,rule.model_version],
    );
    await emitOutbox(client,"ShelfLifePredictionCompleted",id,current.rows[0].family_id ?? null,{predictionId:id,estimatedExpiresAt:expires.toISOString(),confidence,modelVersion:rule.model_version});
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
  },version:Number(x.version)});
});

app.post("/api/v1/shelf-life/predictions/:predictionId/apply", async (req,res) => {
  const userId=actor(req), idempotencyKey=key(req);
  if(!userId)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  if(!idempotencyKey)return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");

  const client=await pool.connect();
  try {
    await client.query("begin");
    const idem=await beginIdempotency(client,req,{predictionId:req.params.predictionId,operation:"apply"},userId);
    if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}

    const q=await client.query("select * from shelf_life_domain.predictions where id=$1 and user_id=$2 for update",[req.params.predictionId,userId]);
    if(!q.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","Prediction not found.");}
    const x=q.rows[0];
    if(x.status==="applied"){
      const response={data:{predictionId:x.id,itemId:x.item_id,estimatedExpiresAt:x.estimated_expires_at,confidence:Number(x.confidence),basis:x.basis,status:"applied"},version:Number(x.version)};
      await finishIdempotency(client,req,200,response);await client.query("commit");return res.json(response);
    }
    if(x.status!=="completed"){await client.query("rollback");return fail(res,422,"BUSINESS_RULE_VIOLATION","Only completed predictions can be applied.");}

    const inventoryBase=(process.env.INVENTORY_SERVICE_BASE_URL??"http://service-inventory:3312/api/v1").replace(/\/$/,"");
    let upstream;
    try {
      upstream=await fetch(inventoryBase+"/inventory/"+encodeURIComponent(String(x.item_id))+"/expiration/confirm",{
        method:"POST",
        headers:{"content-type":"application/json","x-user-id":userId,"x-family-id":String(x.family_id ?? ""),"authorization":req.header("authorization")??"","x-idempotency-key":idempotencyKey},
        body:JSON.stringify({expiresAt:x.estimated_expires_at,source:"estimated"}),
      });
    } catch {
      await client.query("rollback");
      return fail(res,502,"UPSTREAM_ERROR","Inventory service is unavailable.");
    }
    if(!upstream.ok){
      await client.query("rollback");
      return fail(res,502,"UPSTREAM_ERROR","Inventory could not apply the shelf-life prediction.");
    }

    const updated=await client.query(
      "update shelf_life_domain.predictions set status='applied',updated_at=now(),version=version+1 where id=$1 and status='completed' returning *",
      [req.params.predictionId],
    );
    if(!updated.rowCount){await client.query("rollback");return fail(res,409,"CONFLICT","Prediction state changed before apply.");}
    const u=updated.rows[0];
    const response={data:{predictionId:u.id,itemId:u.item_id,estimatedExpiresAt:u.estimated_expires_at,confidence:Number(u.confidence),basis:u.basis,status:"applied"},version:Number(u.version)};
    await emitOutbox(client,"ShelfLifePredictionApplied",String(u.id),u.family_id ?? null,response);
    await finishIdempotency(client,req,200,response);
    await client.query("commit");
    return res.json(response);
  } catch(error) {
    await client.query("rollback");
    return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to apply prediction.");
  } finally {
    client.release();
  }
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));

async function main() {
  await init();
  app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-shelf-life",port})));
}
main().catch((error)=>{console.error(error);process.exit(1)});
