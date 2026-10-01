import express, { type Request, type Response } from "express";
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";
import multer from "multer";
import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

const port = Number(process.env.PORT ?? 3405);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const bucket = process.env.MINIO_BUCKET ?? "gestione-dispensa";
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? "minio",
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? "miniochange",
  },
});

type Body = Record<string, unknown>;

const fail = (res: Response, status: number, code: string, message: string, details: unknown[] = []) =>
  res.status(status).json({ error: { code, message, details, requestId: crypto.randomUUID() } });

function userId(req: Request): string {
  return String(req.header("x-user-id") ?? "").trim();
}

function familyId(req: Request): string | null {
  return String(req.body?.familyId ?? req.query.familyId ?? req.header("x-family-id") ?? "").trim() || null;
}

function idempotencyKey(req: Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
}

async function beginIdempotency(client: PoolClient, req: Request, body: unknown) {
  const key = idempotencyKey(req);
  const actor = userId(req);
  const fam = familyId(req);
  if (!key || !actor) return { kind: "missing" as const };
  const requestHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const existing = await client.query(
    "select actor_user_id,family_id,request_hash,status,response_status,response_body from ocr_domain.idempotency_keys where key=$1 for update",
    [key],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (String(row.actor_user_id) !== actor || String(row.family_id ?? "") !== String(fam ?? "") || row.request_hash !== requestHash) {
      return { kind: "conflict" as const };
    }
    if (row.status === "completed") return { kind: "replay" as const, status: Number(row.response_status), response: row.response_body };
    return { kind: "new" as const };
  }
  await client.query(
    `insert into ocr_domain.idempotency_keys(key,actor_user_id,family_id,request_hash,status,created_at,expires_at)
     values($1,$2,$3,$4,'processing',now(),now()+interval '24 hours')`,
    [key, actor, fam, requestHash],
  );
  return { kind: "new" as const };
}

async function finishIdempotency(client: PoolClient, req: Request, status: number, response: unknown) {
  const key = idempotencyKey(req);
  if (!key) return;
  await client.query(
    "update ocr_domain.idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [key, status, JSON.stringify(response)],
  );
}

async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
  }
}

async function init(): Promise<void> {
  await pool.query("select 1");
}


app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "service-ocr" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ready", service: "service-ocr" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

app.post("/api/v1/ocr/jobs", upload.single("file"), async (req, res) => {
  const actor = userId(req);
  const type = String(req.body?.type ?? "");
  const file = req.file;
  if (!actor) return fail(res, 401, "UNAUTHENTICATED", "Authenticated user required.");
  if (!file) return fail(res, 400, "VALIDATION_ERROR", "file is required.");
  if (type !== "receipt" && type !== "pantry_image") return fail(res, 400, "VALIDATION_ERROR", "type must be receipt or pantry_image.");
  if (idempotencyKey(req) === null) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, {
      type,
      filename: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      familyId: familyId(req),
    });
    if (idem.kind === "missing") {
      await client.query("rollback");
      return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.");
    }
    if (idem.kind === "conflict") {
      await client.query("rollback");
      return fail(res, 409, "CONFLICT", "Idempotency key conflict.");
    }
    if (idem.kind === "replay") {
      await client.query("commit");
      return res.status(idem.status).json(idem.response);
    }

    const jobId = crypto.randomUUID();
    const objectKey = `ocr/${jobId}/source`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: { originalfilename: file.originalname.slice(0, 200) },
    }));

    await client.query(
      `insert into ocr_domain.ocr_jobs(id,user_id,family_id,type,object_key,status,progress)
       values($1,$2,$3,$4,$5,'queued',0)`,
      [jobId, actor, familyId(req), type, objectKey],
    );
    const response = { data: { jobId, status: "queued", type, objectKey }, version: 1 };
    await finishIdempotency(client, req, 202, response);
    await client.query("commit");

    // Queue payload intentionally contains only references, never the binary file.
    try {
      const { createClient } = await import("redis");
      const redis = createClient({ url: redisUrl });
      await redis.connect();
      await redis.lPush("q:ocr-processing", JSON.stringify({
        eventId: crypto.randomUUID(),
        eventType: "OCR_JOB_REQUESTED",
        data: { jobId, familyId: familyId(req), userId: actor, objectKey, type },
      }));
      await redis.quit();
    } catch {
      // The durable DB job exists even when Redis is temporarily unavailable.
    }

    return res.status(202).json(response);
  } catch (error) {
    await client.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to create OCR job.");
  } finally {
    client.release();
  }
});

app.post("/api/v1/internal/ocr/jobs/:jobId/process", async (req,res)=>{
  const token=process.env.INTERNAL_SERVICE_TOKEN?.trim()??"";
  if(!token||req.header("authorization")!=="Bearer "+token)return fail(res,401,"UNAUTHENTICATED","Internal service authentication is required.");
  const jobId=req.params.jobId;
  const client=await pool.connect();
  try{
    await client.query("begin");
    const job=await client.query("select * from ocr_domain.ocr_jobs where id=$1 for update",[jobId]);
    if(!job.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","OCR job not found.");}
    const j=job.rows[0];
    if(j.status==="completed"||j.status==="cancelled"){await client.query("commit");return res.json({data:{jobId:j.id,status:j.status}});}
    await client.query("update ocr_domain.ocr_jobs set status='needs_review',progress=100,updated_at=now(),version=version+1 where id=$1",[jobId]);
    const draft=await client.query(
      `insert into ocr_domain.ocr_drafts(job_id,confidence,status,raw_result)
       values($1,0.0,'draft',$2::jsonb) returning *`,
      [jobId,JSON.stringify({status:"needs_review",source:"ocr-engine",items:[]})],
    );
    await client.query(
      `insert into ocr_domain.outbox_events
       (event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
       values($1,'OcrDraftReady',1,$2,$3,$4,now(),$5::jsonb,now())`,
      [crypto.randomUUID(),jobId,j.family_id,crypto.randomUUID(),JSON.stringify({jobId,draftId:draft.rows[0]?.id??null})],
    );
    await client.query("commit");
    return res.status(200).json({data:{jobId,status:"needs_review",draftId:draft.rows[0]?.id??null},version:j.version+1});
  }catch(error){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",error instanceof Error?error.message:"Unable to process OCR job.");}
  finally{client.release();}
});

app.get("/api/v1/ocr/jobs/:jobId", async (req, res) => {
  const actor = userId(req);
  if (!actor) return fail(res, 401, "UNAUTHENTICATED", "Authenticated user required.");
  const q = await pool.query(
    `select j.id,j.status,j.type,j.progress,j.error_code,
      coalesce(d.id::text,'') as draft_id,j.version
     from ocr_domain.ocr_jobs j
     left join ocr_domain.ocr_drafts d on d.job_id=j.id and d.status='draft'
     where j.id=$1 and j.user_id=$2`,
    [req.params.jobId, actor],
  );
  if (!q.rowCount) return fail(res,404,"NOT_FOUND","OCR job not found.");
  const row=q.rows[0];
  return res.json({
    data:{
      jobId:row.id,
      status:row.status,
      type:row.type,
      progress:Number(row.progress),
      draftId:row.draft_id || null,
      error:row.error_code ?? null,
    },
    version:Number(row.version),
  });
});

app.get("/api/v1/ocr/drafts/:draftId", async (req,res) => {
  const actor=userId(req);
  if(!actor)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  const q=await pool.query(
    `select d.id,d.job_id,d.confidence,d.status,d.raw_result,d.version,j.type,j.user_id
     from ocr_domain.ocr_drafts d
     join ocr_domain.ocr_jobs j on j.id=d.job_id
     where d.id=$1 and j.user_id=$2`,
    [req.params.draftId,actor],
  );
  if(!q.rowCount)return fail(res,404,"NOT_FOUND","OCR draft not found.");
  const row=q.rows[0];
  const raw=(typeof row.raw_result==="object"&&row.raw_result!==null)?row.raw_result as Record<string,unknown>:{};
  return res.json({
    data:{
      draftId:row.id,
      jobId:row.job_id,
      type:row.type,
      confidence:Number(row.confidence),
      items:Array.isArray(raw.items)?raw.items:[],
    },
    version:Number(row.version),
  });
});

app.post("/api/v1/ocr/drafts/:draftId/reject", async(req,res)=>{
  const actor=userId(req);if(!actor)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");const client=await pool.connect();
  try{await client.query("begin");const q=await client.query(`select d.* from ocr_domain.ocr_drafts d join ocr_domain.ocr_jobs j on j.id=d.job_id where d.id=$1 and j.user_id=$2 for update`,[req.params.draftId,actor]);if(!q.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","OCR draft not found.");}
  const idem=await beginIdempotency(client,req,req.body??{});if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}
  const u=await client.query(`update ocr_domain.ocr_drafts set status='rejected',updated_at=now(),version=version+1 where id=$1 returning *`,[req.params.draftId]);const response={data:{draftId:u.rows[0].id,status:"rejected",applied:false},version:u.rows[0].version};await client.query(`insert into ocr_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at) values($1,'OcrDraftRejected',1,$2,(select family_id from ocr_domain.ocr_jobs where id=$2),$3,now(),$4::jsonb,now())`,[crypto.randomUUID(),u.rows[0].job_id,crypto.randomUUID(),JSON.stringify(response)]);await finishIdempotency(client,req,200,response);await client.query("commit");return res.json(response);}
  catch(e){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",e instanceof Error?e.message:"Unable to reject draft.");}finally{client.release();}
});

app.post("/api/v1/ocr/drafts/:draftId/confirm", async(req,res)=>{
  const actor=userId(req);if(!actor)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");const client=await pool.connect();
  try{await client.query("begin");const q=await client.query(`select d.* from ocr_domain.ocr_drafts d join ocr_domain.ocr_jobs j on j.id=d.job_id where d.id=$1 and j.user_id=$2 for update`,[req.params.draftId,actor]);if(!q.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","OCR draft not found.");}
  const body=req.body as Body;if(!Array.isArray(body.items)) {await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","items is required.");}
  const idem=await beginIdempotency(client,req,body);if(idem.kind==="missing"){await client.query("rollback");return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");}if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}
  const u=await client.query(`update ocr_domain.ocr_drafts set status='confirmed',raw_result=$2,updated_at=now(),version=version+1 where id=$1 returning *`,[req.params.draftId,JSON.stringify({items:body.items})]);const response={data:{draftId:u.rows[0].id,status:"confirmed",applied:false},version:u.rows[0].version};await client.query(`insert into ocr_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at) values($1,'OcrDraftConfirmed',1,$2,(select family_id from ocr_domain.ocr_jobs where id=$2),$3,now(),$4::jsonb,now())`,[crypto.randomUUID(),u.rows[0].job_id,crypto.randomUUID(),JSON.stringify(response)]);await finishIdempotency(client,req,200,response);await client.query("commit");return res.json(response);}
  catch(e){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",e instanceof Error?e.message:"Unable to confirm draft.");}finally{client.release();}
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));
init().then(()=>ensureBucket()).then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-ocr",port,bucket})))).catch(e=>{console.error(e);process.exit(1)});
