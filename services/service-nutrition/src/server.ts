import express, { type Request, type Response } from "express";
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";
import { createClient } from "redis";
import { consumedGramsForQuantity, loadNutritionSnapshot, nutrientMultiplier, type NutritionSnapshot } from "./catalog-client.js";
import { isDiarySource, isDiaryUnit, isNonNegativeNumber, isPositiveNumber, isSummaryPeriod, validIfMatch } from "./validation.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT ?? 3402);
const catalogBaseUrl = process.env.CATALOG_SERVICE_BASE_URL ?? "http://service-catalog:3314/api/v1";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Body = Record<string, unknown>;

const fail = (res: Response, status: number, code: string, message: string): Response => { const requestId=crypto.randomUUID(); return res.status(status).json({error:{code,message,details:[],retryable:status>=502,requestId},meta:{requestId,traceId:requestId,schemaVersion:"1.0"}}); };

const actor = (req: Request): string => String(req.header("x-user-id") ?? "").trim();
const key = (req: Request): string | null => {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
};
const match = (req: Request): number | null => {
  const value = req.header("if-match");
  if (!value) return null;
  const parsed = Number(value.replace(/^W\/?/i, "").replace(/"/g, ""));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
};
const hash = (value: unknown): string => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function beginIdempotency(client: PoolClient, req: Request, body: unknown) {
  const idempotencyKey = key(req);
  const userId = actor(req);
  if (!idempotencyKey || !userId) return { kind: "missing" as const };

  const requestHash = hash(body);
  const existing = await client.query(
    "select actor_user_id,request_hash,status,response_status,response_body from nutrition_domain.idempotency_keys where key=$1 for update",
    [idempotencyKey],
  );

  if (existing.rowCount) {
    const row = existing.rows[0];
    if (String(row.actor_user_id) !== userId || row.request_hash !== requestHash) return { kind: "conflict" as const };
    if (row.status === "completed") return { kind: "replay" as const, status: Number(row.response_status), response: row.response_body };
    return { kind: "new" as const };
  }

  await client.query(
    `insert into nutrition_domain.idempotency_keys(key,actor_user_id,family_id,request_hash,status,created_at,expires_at)
     values($1,$2,null,$3,'processing',now(),now()+interval '24 hours')`,
    [idempotencyKey, userId, requestHash],
  );
  return { kind: "new" as const };
}

async function finishIdempotency(client: PoolClient, req: Request, status: number, response: unknown): Promise<void> {
  const idempotencyKey = key(req);
  if (!idempotencyKey) return;
  await client.query(
    "update nutrition_domain.idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [idempotencyKey, status, JSON.stringify(response)],
  );
}

async function emitOutbox(client: PoolClient, type: string, aggregateId: string, userId: string, payload: unknown): Promise<void> {
  await client.query(
    `insert into nutrition_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
     values($1,$2,1,$3,null,$4,now(),$5::jsonb,now())`,
    [crypto.randomUUID(), type, aggregateId, crypto.randomUUID(), JSON.stringify(toEventPayload({ actorUserId: userId, payload }))],
  );
}

const targetDto = (row: Record<string, unknown>) => ({
  caloriesKcal: Number(row.calories_kcal),
  proteinG: Number(row.protein_g),
  carbsG: Number(row.carbs_g),
  fatG: Number(row.fat_g),
  version: Number(row.version),
});

function toEventPayload(payload: unknown): unknown {
  if (typeof payload === "object" && payload !== null && Object.hasOwn(payload as object, "data")) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

type DomainEvent = {
  eventId: string;
  eventType: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
};

const eventRedis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const eventStream = process.env.EVENT_STREAM ?? "events:domain";
const eventGroup = process.env.EVENT_CONSUMER_GROUP ?? "nutrition";
const eventConsumer = process.env.EVENT_CONSUMER_NAME ?? `nutrition-${process.pid}`;

async function consumeInventoryEvents(): Promise<void> {
  await eventRedis.connect();
  await eventRedis.xGroupCreate(eventStream, eventGroup, process.env.EVENT_GROUP_START_ID ?? "0-0", { MKSTREAM: true }).catch((error: unknown) => {
    if (!String(error).includes("BUSYGROUP")) throw error;
  });

  while (true) {
    const result = await eventRedis.xReadGroup(
      eventGroup,
      eventConsumer,
      [{ key: eventStream, id: ">" }],
      { COUNT: 10, BLOCK: 1000 },
    );

    for (const streamResult of result ?? []) {
      for (const message of streamResult.messages) {
        try {
          const raw = message.message.event;
          const event = JSON.parse(String(raw)) as DomainEvent;
          if (event.eventType !== "inventory.stock.consumed.v1") {
            await eventRedis.xAck(eventStream, eventGroup, message.id);
            continue;
          }

          const payload = event.payload ?? {};
          const userId = typeof payload.actorUserId === "string" ? payload.actorUserId : "";
          const productId = typeof payload.productId === "string" ? payload.productId : "";
          const quantity = typeof payload.quantity === "string" ? Number(payload.quantity) : Number(payload.quantity);
          const unit = typeof payload.unit === "string" ? payload.unit : "";
          const movementId = typeof payload.movementId === "string" ? payload.movementId : "";
          if (!event.eventId || !userId || !productId || !Number.isFinite(quantity) || quantity <= 0 || !isDiaryUnit(unit) || !movementId) {
            throw new Error("Invalid inventory.stock.consumed.v1 event payload.");
          }

          const client = await pool.connect();
          try {
            await client.query("begin");
            const consumed = await client.query(
              `insert into nutrition_domain.event_consumers(event_id,event_type)
               values($1,$2) on conflict(event_id) do nothing returning event_id`,
              [event.eventId, event.eventType],
            );
            if (!consumed.rowCount) {
              await client.query("commit");
              await eventRedis.xAck(eventStream, eventGroup, message.id);
              client.release();
              continue;
            }

            const snapshot = await loadNutritionSnapshot(
              catalogBaseUrl,
              undefined,
              productId,
            );
            if (!snapshot) throw new Error("Product nutrition data not found.");

            const entryId = crypto.randomUUID();
            const date = typeof event.occurredAt === "string" && !Number.isNaN(new Date(event.occurredAt).getTime())
              ? new Date(event.occurredAt).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10);
            await client.query(
              `insert into nutrition_domain.diary_entries
               (id,user_id,date,meal,product_id,quantity,unit,source,source_movement_id,nutrition_snapshot)
               values($1,$2,$3,'other',$4,$5,$6,'inventory',$7,$8::jsonb)`,
              [entryId, userId, date, productId, quantity, unit, movementId, JSON.stringify(snapshot)],
            );
            await emitOutbox(client, "NutritionEntryRecorded", entryId, userId, {
              entryId,
              userId,
              date,
              meal: "other",
              productId,
              quantity,
              unit,
              source: "inventory",
            });
            await client.query("commit");
            await eventRedis.xAck(eventStream, eventGroup, message.id);
          } catch (error) {
            await client.query("rollback").catch(() => undefined);
            console.error(JSON.stringify({
              service: "service-nutrition",
              event: "inventory_event_processing_failed",
              eventId: event.eventId,
              error: error instanceof Error ? error.message : String(error),
            }));
          } finally {
            client.release();
          }
        } catch (error) {
          console.error(JSON.stringify({
            service: "service-nutrition",
            event: "domain_event_processing_failed",
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    }
  }
}

async function init(): Promise<void> {
  await pool.query("select 1");
}

app.get("/health/live", (_req,res) => res.json({status:"ok",service:"service-nutrition"}));
app.get("/health/ready", async (_req,res) => {
  try { await pool.query("select 1"); res.json({status:"ready",service:"service-nutrition"}); }
  catch { res.status(503).json({status:"not_ready",service:"service-nutrition"}); }
});

app.get("/api/v1/nutrition/targets", async (req,res) => {
  const userId=actor(req); if(!userId)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  const q=await pool.query("select * from nutrition_domain.targets where user_id=$1",[userId]);
  const row=q.rows[0] as Record<string,unknown>|undefined;
  return res.json({data: row ? targetDto(row) : {caloriesKcal:2000,proteinG:100,carbsG:250,fatG:70,version:1}});
});

app.put("/api/v1/nutrition/targets", async(req,res)=>{
  const userId=actor(req), idempotencyKey=key(req), version=match(req);
  if(!userId)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  if(!idempotencyKey||version===null)return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key and If-Match are required.");
  const body=req.body as Body;
  for(const field of ["caloriesKcal","proteinG","carbsG","fatG"]) if(!isNonNegativeNumber(body[field])) return fail(res,400,"VALIDATION_ERROR",`${field} must be non-negative.`);
  const client=await pool.connect();
  try{
    await client.query("begin");
    const idem=await beginIdempotency(client,req,body);
    if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}
    const current=await client.query("select * from nutrition_domain.targets where user_id=$1 for update",[userId]);
    if(!current.rowCount && version!==1){await client.query("rollback");return fail(res,412,"PRECONDITION_FAILED","Target version changed.");}
    if(current.rowCount && Number(current.rows[0].version)!==version){await client.query("rollback");return fail(res,412,"PRECONDITION_FAILED","Target version changed.");}
    const q=await client.query(
      `insert into nutrition_domain.targets(user_id,calories_kcal,protein_g,carbs_g,fat_g)
       values($1,$2,$3,$4,$5)
       on conflict(user_id) do update set calories_kcal=excluded.calories_kcal,protein_g=excluded.protein_g,carbs_g=excluded.carbs_g,fat_g=excluded.fat_g,updated_at=now(),version=nutrition_domain.targets.version+1
       returning *`,
      [userId,body.caloriesKcal,body.proteinG,body.carbsG,body.fatG],
    );
    const row=q.rows[0] as Record<string,unknown>; const response={data:targetDto(row),version:Number(row.version)};
    await emitOutbox(client,"NutritionTargetUpdated",userId,userId,response);
    await finishIdempotency(client,req,200,response); await client.query("commit"); return res.json(response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to update nutrition target.");}
  finally{client.release();}
});

app.get("/api/v1/nutrition/diary", async(req,res)=>{
  const userId=actor(req);if(!userId)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  const limit=Math.min(Math.max(Number(req.query.limit??50),1),100),offset=Math.max(Number(req.query.cursor??0),0);
  const from=String(req.query.from??""),to=String(req.query.to??"");
  const q=await pool.query(
    `select id,date,meal,product_id,quantity,unit,source,source_movement_id,created_at,updated_at,version
     from nutrition_domain.diary_entries where user_id=$1 and ($2='' or date >= $2::date) and ($3='' or date <= $3::date)
     order by date desc,created_at desc limit $4 offset $5`,
    [userId,from,to,limit+1,offset],
  );
  const hasNext=q.rows.length>limit; const rows=hasNext?q.rows.slice(0,limit):q.rows;
  return res.json({items:rows.map(x=>({entryId:x.id,date:x.date,meal:x.meal,productId:x.product_id,quantity:Number(x.quantity),unit:x.unit,source:x.source})),nextCursor:hasNext?String(offset+limit):null});
});

app.post("/api/v1/nutrition/diary", async(req,res)=>{

  const userId=actor(req),idempotencyKey=key(req);if(!userId)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");if(!idempotencyKey)return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");
  const body=req.body as Body;const quantity=body.quantity;
  if(Object.keys(body).some((field)=>!["date","meal","productId","quantity","unit","source","sourceMovementId"].includes(field)))return fail(res,400,"VALIDATION_ERROR","Only date, meal, productId, quantity, unit, source and sourceMovementId are accepted.");
  const source=isDiarySource(body.source ?? "manual") ? String(body.source ?? "manual") : "";
  const sourceMovementId=body.sourceMovementId == null ? null : String(body.sourceMovementId);
  if(!source)return fail(res,400,"VALIDATION_ERROR","source must be manual or inventory.");
  if(typeof body.date!=="string"||typeof body.meal!=="string"||typeof body.productId!=="string"||!isPositiveNumber(quantity)||!isDiaryUnit(body.unit))return fail(res,400,"VALIDATION_ERROR","date, meal, productId, quantity and unit are required.");
  const client=await pool.connect();
  try{await client.query("begin");const idem=await beginIdempotency(client,req,body);if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}
    if (!isDiaryUnit(body.unit)) { await client.query("rollback"); return fail(res,400,"VALIDATION_ERROR","Nutrition diary entries require a supported mass, package or volume unit."); }
    const snapshot = await loadNutritionSnapshot(catalogBaseUrl, req.header("authorization") ?? undefined, String(body.productId));
    if (!snapshot) { await client.query("rollback"); return fail(res,404,"NOT_FOUND","Product nutrition data not found."); }
    const id=crypto.randomUUID();
    const q=await client.query(`insert into nutrition_domain.diary_entries(id,user_id,date,meal,product_id,quantity,unit,source,source_movement_id,nutrition_snapshot) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning *`,[id,userId,body.date,body.meal,body.productId,quantity,body.unit,source,sourceMovementId,JSON.stringify(snapshot)]);
    const x=q.rows[0];const response={data:{entryId:x.id,date:x.date,meal:x.meal,productId:x.product_id,quantity:Number(x.quantity),unit:x.unit,source:x.source},version:x.version};
    await emitOutbox(client,"NutritionEntryRecorded",id,userId,response);await finishIdempotency(client,req,201,response);await client.query("commit");return res.status(201).json(response);
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to record diary entry.");}finally{client.release();}
});

app.get("/api/v1/nutrition/summary", async(req,res)=>{
  const userId=actor(req);
  if(!userId)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  const period=String(req.query.period??"today");
  if(!isSummaryPeriod(period))return fail(res,400,"VALIDATION_ERROR","period must be today or week.");
  const days=period==="today"?0:6;
  const q=await pool.query(
    `select id,date,meal,product_id,quantity,unit,created_at,nutrition_snapshot
       from nutrition_domain.diary_entries
      where user_id=$1 and date between current_date-$2::integer and current_date
      order by date desc,created_at desc`,
    [userId,days],
  );
  let caloriesKcal=0,proteinG=0,carbsG=0,fatG=0,fiberG=0;
  const items:Array<Record<string,unknown>>=[];
  for(const row of q.rows){
    const snapshot=typeof row.nutrition_snapshot==="object"&&row.nutrition_snapshot!==null
      ? row.nutrition_snapshot as NutritionSnapshot
      : null;
    if(!snapshot)continue;
    const quantity=Number(row.quantity);
    const unit=String(row.unit);
    const grams=consumedGramsForQuantity(quantity,unit,snapshot);
    if(grams == null && unit !== "g" && unit !== "kg") {
      items.push({
        movementId:String(row.id), productId:String(row.product_id),
        productName:String(snapshot.productName??row.product_id), brand:snapshot.brand??null,
        quantity, unit, meal:String(row.meal), date:String(row.date),
        occurredAt:new Date(row.created_at).toISOString(),
        nutrients:{calories:0,protein:0,carbs:0,fat:0,fiber:0},
        confidence:"UNKNOWN",
      });
      continue;
    }
    const multiplier=grams == null ? nutrientMultiplier(quantity,unit) : grams/100;
    const values={
      calories:Number(snapshot.caloriesKcalPer100g??0)*multiplier,
      protein:Number(snapshot.proteinGPer100g??0)*multiplier,
      carbs:Number(snapshot.carbsGPer100g??0)*multiplier,
      fat:Number(snapshot.fatGPer100g??0)*multiplier,
      fiber:Number(snapshot.fiberGPer100g??0)*multiplier,
    };
    caloriesKcal+=values.calories; proteinG+=values.protein; carbsG+=values.carbs; fatG+=values.fat; fiberG+=values.fiber;
    items.push({
      movementId:String(row.id),
      productId:String(row.product_id),
      productName:String(snapshot.productName??row.product_id),
      brand:snapshot.brand??null,
      quantity,
      unit,
      meal:String(row.meal),
      date:String(row.date),
      occurredAt:new Date(row.created_at).toISOString(),
      nutrients:{
        calories:Number(values.calories.toFixed(2)),
        protein:Number(values.protein.toFixed(2)),
        carbs:Number(values.carbs.toFixed(2)),
        fat:Number(values.fat.toFixed(2)),
        fiber:Number(values.fiber.toFixed(2)),
      },
      confidence:String(snapshot.confidence??"UNKNOWN"),
    });
  }
  const round=(value:number)=>Number(value.toFixed(2));
  const totals={calories:round(caloriesKcal),protein:round(proteinG),carbs:round(carbsG),fat:round(fatG),fiber:round(fiberG)};
  return res.json({
    data:{
      caloriesKcal:totals.calories,
      proteinG:totals.protein,
      carbsG:totals.carbs,
      fatG:totals.fat,
      period,
      since:period==="today" ? new Date().toISOString().slice(0,10) : new Date(Date.now()-6*86400000).toISOString().slice(0,10),
      totals,
      items,
    },
  });
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));
init().then(async()=>{ app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-nutrition",port}))); void consumeInventoryEvents().catch(e=>{console.error(JSON.stringify({service:"service-nutrition",event:"event_consumer_failed",error:e instanceof Error?e.message:String(e)}));process.exitCode=1;}); }).catch(e=>{console.error(e);process.exit(1)});
