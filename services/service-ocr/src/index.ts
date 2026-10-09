import { isConfidence, isJobStatus, isJobType, isPositiveNumber } from "./validation.js";
import express, { type Request, type Response } from "express";
import { createContextAwarePool, setDbRequestContextFromHeaders, type PoolClient } from "@gestione-dispensa/runtime-db/postgres-client.js";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use((req, _res, next) => { setDbRequestContextFromHeaders(req.headers); next(); });

const port = Number(process.env.PORT ?? 3405);
const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
const familyServiceBaseUrl = (process.env.FAMILY_SERVICE_BASE_URL ?? "http://service-family:3311/api/v1").replace(/\/$/, "");
const maxUploadBytes = 10 * 1024 * 1024;

const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const minioEndpoint = process.env.MINIO_ENDPOINT ?? "http://minio:9000";
const minioBucket = process.env.MINIO_BUCKET ?? "gestione-dispensa";
const minioAccessKey = process.env.MINIO_ACCESS_KEY ?? "minio";
const minioSecretKey = process.env.MINIO_SECRET_KEY ?? "miniochange";
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";
const ocrProviderUrl = process.env.OCR_PROVIDER_URL?.trim() ?? "";
const ocrProviderToken = process.env.OCR_PROVIDER_TOKEN?.trim() ?? "";

type Body = Record<string, unknown>;
type MultipartFile = { fieldName: string; filename: string; mimeType: string; buffer: Buffer };
type MultipartForm = { fields: Record<string, string>; file?: MultipartFile };

const fail = (res: Response, status: number, code: string, message: string, details: unknown[] = []) => { const requestId=crypto.randomUUID(); return res.status(status).json({error:{code,message,details,retryable:status>=502,requestId},meta:{requestId,traceId:requestId,schemaVersion:"1.0"}}); };

function userId(req: Request): string {
  return String(req.header("x-user-id") ?? "").trim();
}

async function authorizeFamily(user: string, family: string, write: boolean): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  try {
    const response = await fetch(`${familyServiceBaseUrl}/families/${encodeURIComponent(family)}/members`, { headers: { "x-user-id": user, accept: "application/json" }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." };
    const payload = await response.json() as { items?: Array<{ userId: string; role: string; status: string }> };
    const member = payload.items?.find((item) => item.userId === user);
    if (!member || member.status !== "ACTIVE") return { ok: false, status: 403, code: "FORBIDDEN", message: "User is not an active member of the family." };
    if (write && member.role === "viewer") return { ok: false, status: 403, code: "FORBIDDEN", message: "Viewer role is read-only." };
    return { ok: true };
  } catch { return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." }; }
}
function idempotencyKey(req: Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
}

function requestHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function beginIdempotency(client: PoolClient, req: Request, body: unknown, familyId: string | null) {
  const key = idempotencyKey(req);
  const actor = userId(req);
  if (!key || !actor) return { kind: "missing" as const };

  const hash = requestHash(body);
  const existing = await client.query(
    "select actor_user_id,family_id,request_hash,status,response_status,response_body from ocr_domain.idempotency_keys where key=$1 for update",
    [key],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (String(row.actor_user_id) !== actor || String(row.family_id ?? "") !== String(familyId ?? "") || row.request_hash !== hash) {
      return { kind: "conflict" as const };
    }
    if (row.status === "completed") return { kind: "replay" as const, status: Number(row.response_status), response: row.response_body };
    return { kind: "new" as const };
  }

  await client.query(
    "insert into ocr_domain.idempotency_keys(key,actor_user_id,family_id,request_hash,status,created_at,expires_at) values($1,$2,$3,$4,'processing',now(),now()+interval '24 hours')",
    [key, actor, familyId, hash],
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

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac("AWS4" + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
}

async function putMinioObject(objectKey: string, data: Buffer, contentType: string): Promise<void> {
  const endpoint = new URL(minioEndpoint);
  const region = "us-east-1";
  const service = "s3";
  const host = endpoint.host;
  const canonicalUri =
    "/" +
    encodePathPart(minioBucket) +
    "/" +
    objectKey.split("/").map(encodePathPart).join("/");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash("sha256").update(data).digest("hex");

  const canonicalHeaders =
    "content-type:" + contentType + "\n" +
    "host:" + host + "\n" +
    "x-amz-content-sha256:" + payloadHash + "\n" +
    "x-amz-date:" + amzDate + "\n";
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest =
    "PUT\n" +
    canonicalUri + "\n\n" +
    canonicalHeaders + "\n" +
    signedHeaders + "\n" +
    payloadHash;
  const credentialScope = shortDate + "/" + region + "/" + service + "/aws4_request";
  const stringToSign =
    "AWS4-HMAC-SHA256\n" +
    amzDate + "\n" +
    credentialScope + "\n" +
    crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const signature = hmac(signingKey(minioSecretKey, shortDate, region, service), stringToSign).toString("hex");
  const authorization =
    "AWS4-HMAC-SHA256 Credential=" + minioAccessKey + "/" + credentialScope +
    ", SignedHeaders=" + signedHeaders +
    ", Signature=" + signature;

  const response = await fetch(new URL(canonicalUri, endpoint), {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      Host: host,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      Authorization: authorization,
    },
    body: new Uint8Array(data),
  });
  if (!response.ok) {
    throw new Error("MinIO upload failed with HTTP " + response.status);
  }
}

let minioBucketReady = false;

async function ensureMinioBucket(): Promise<void> {
  const endpoint = new URL("/" + encodePathPart(minioBucket), minioEndpoint);
  const probe = await fetch(endpoint, { method: "HEAD", headers: { Host: endpoint.host } }).catch(() => null);
  if (probe?.ok) { minioBucketReady = true; return; }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = amzDate.slice(0, 8);
  const region = "us-east-1";
  const service = "s3";
  const host = endpoint.host;
  const canonicalUri = "/" + encodePathPart(minioBucket);
  const payloadHash = crypto.createHash("sha256").update("").digest("hex");
  const canonicalHeaders = "host:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = "PUT\n" + canonicalUri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
  const scope = shortDate + "/" + region + "/" + service + "/aws4_request";
  const stringToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + crypto.createHash("sha256").update(canonicalRequest).digest("hex");
  const signature = hmac(signingKey(minioSecretKey, shortDate, region, service), stringToSign).toString("hex");

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Host: host,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      Authorization: "AWS4-HMAC-SHA256 Credential=" + minioAccessKey + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature,
    },
  });
  if (!response.ok && response.status !== 409) throw new Error("MinIO bucket initialization failed with HTTP " + response.status);
  minioBucketReady = true;
}

async function readRequest(req: Request, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new Error("UPLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseContentDisposition(value: string): { name?: string; filename?: string } {
  const name = /name="([^"]*)"/i.exec(value)?.[1];
  const filename = /filename="([^"]*)"/i.exec(value)?.[1];
  return { name, filename };
}

async function readMultipart(req: Request): Promise<MultipartForm> {
  const contentType = String(req.header("content-type") ?? "");
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new Error("MULTIPART_BOUNDARY_MISSING");

  const boundary = Buffer.from("--" + (match[1] ?? match[2] ?? ""));
  const body = await readRequest(req, maxUploadBytes + 1024 * 1024);
  const fields: Record<string, string> = {};
  let file: MultipartFile | undefined;
  let cursor = 0;

  while (true) {
    const start = body.indexOf(boundary, cursor);
    if (start < 0) break;
    let partStart = start + boundary.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) break;
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd < 0) throw new Error("MULTIPART_HEADERS_INVALID");

    const headers = body.subarray(partStart, headerEnd).toString("utf8");
    const headerLines = headers.split("\r\n");
    const headerMap: Record<string, string> = {};
    for (const line of headerLines) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      headerMap[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }

    const disposition = parseContentDisposition(headerMap["content-disposition"] ?? "");
    if (!disposition.name) throw new Error("MULTIPART_FIELD_NAME_MISSING");
    const contentStart = headerEnd + 4;
    const next = body.indexOf(Buffer.from("\r\n" + boundary.toString("utf8")), contentStart);
    if (next < 0) throw new Error("MULTIPART_BOUNDARY_INVALID");
    const value = body.subarray(contentStart, next);

    if (disposition.filename !== undefined) {
      if (disposition.name !== "file") throw new Error("UNSUPPORTED_FILE_FIELD");
      if (value.length > maxUploadBytes) throw new Error("UPLOAD_TOO_LARGE");
      file = {
        fieldName: disposition.name,
        filename: disposition.filename,
        mimeType: headerMap["content-type"] ?? "application/octet-stream",
        buffer: value,
      };
    } else {
      fields[disposition.name] = value.toString("utf8").trim();
    }
    cursor = next + 2;
  }

  return { fields, file };
}

type OcrDetectedItem = {
  name: string;
  barcode?: string | null;
  quantity?: number | null;
  unit?: string | null;
  priceMinor?: number | null;
  currency?: string | null;
  confidence: number;
  productId?: string | null;
};

type OcrProviderResult = {
  provider: string;
  confidence: number;
  text?: string;
  warnings: string[];
  items: OcrDetectedItem[];
};

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

function normalizeOcrItems(value: unknown): OcrDetectedItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): OcrDetectedItem[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name.trim()) return [];
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return [];
    return [{
      name: row.name.trim().slice(0, 300),
      barcode: typeof row.barcode === "string" ? row.barcode : null,
      quantity: typeof row.quantity === "number" && Number.isFinite(row.quantity) ? row.quantity : null,
      unit: typeof row.unit === "string" ? row.unit.slice(0, 16) : null,
      priceMinor: typeof row.priceMinor === "number" && Number.isFinite(row.priceMinor) ? Math.trunc(row.priceMinor) : null,
      currency: typeof row.currency === "string" ? row.currency.slice(0, 3).toUpperCase() : null,
      confidence,
      productId: typeof row.productId === "string" ? row.productId : null,
    }];
  });
}

async function runOcrProvider(input: {
  readonly jobId: string;
  readonly familyId: string | null;
  readonly userId: string;
  readonly type: string;
  readonly objectKey: string;
}): Promise<OcrProviderResult> {
  if (!ocrProviderUrl) {
    return {
      provider: "disabled",
      confidence: 0,
      warnings: ["ocr_provider_disabled"],
      items: [],
    };
  }

  const response = await fetch(ocrProviderUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(ocrProviderToken ? { authorization: "Bearer " + ocrProviderToken } : {}),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("OCR provider returned HTTP " + response.status);
  const payload = await response.json() as Record<string, unknown>;
  const confidence = Number(payload.confidence ?? 0);
  return {
    provider: typeof payload.provider === "string" ? payload.provider : "external",
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    text: typeof payload.text === "string" ? payload.text.slice(0, 50000) : undefined,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.filter((x): x is string => typeof x === "string").slice(0, 20) : [],
    items: normalizeOcrItems(payload.items),
  };
}

function ocrJobDto(row: Record<string, unknown>) {
  return {
    jobId: row.id,
    status: row.status,
    type: row.type,
    progress: Number(row.progress),
    draftId: row.draft_id ?? null,
    error: row.error_code ?? null,
  };
}

async function init(): Promise<void> {
  await pool.query("select 1");
}

app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "service-ocr" }));
app.get("/health/ready", async (_req, res) => {
  try { await pool.query("select 1"); res.json({ status: "ready", service: "service-ocr" }); }
  catch { res.status(503).json({ status: "not_ready" }); }
});

app.get("/api/v1/internal/ocr/jobs/recoverable", async (req, res) => {
  if (!requireInternal(req, res)) return;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  try {
    const q = await pool.query(
      `select j.id,j.user_id,j.family_id,j.type,j.object_key,j.status,j.progress,j.error_code,
              (select d.id from ocr_domain.ocr_drafts d where d.job_id=j.id order by d.created_at desc limit 1) as draft_id
       from ocr_domain.ocr_jobs j
       where j.status in ('queued','processing')
       order by j.created_at asc
       limit $1`,
      [limit],
    );
    return res.json({ data: q.rows.map(ocrJobDto).map((x, index) => ({
      ...x,
      userId: q.rows[index].user_id,
      familyId: q.rows[index].family_id,
      objectKey: q.rows[index].object_key,
    })) });
  } catch {
    return fail(res, 500, "INTERNAL_ERROR", "Unable to recover OCR jobs.");
  }
});

app.post("/api/v1/internal/ocr/jobs/:jobId/process", async (req, res) => {
  if (!requireInternal(req, res)) return;
  const client = await pool.connect();
  let job: Record<string, unknown>;
  try {
    await client.query("begin");
    const q = await client.query("select * from ocr_domain.ocr_jobs where id=$1 for update", [req.params.jobId]);
    if (!q.rowCount) { await client.query("rollback"); return fail(res, 404, "NOT_FOUND", "OCR job not found."); }
    job = q.rows[0];
    if (job.status === "completed" || job.status === "needs_review" || job.status === "cancelled") {
      await client.query("commit");
      return res.status(200).json({ data: ocrJobDto(job) });
    }
    await client.query("update ocr_domain.ocr_jobs set status='processing',progress=20,updated_at=now(),version=version+1 where id=$1", [req.params.jobId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to start OCR job.");
  } finally {
    client.release();
  }

  let provider: OcrProviderResult;
  try {
    provider = await runOcrProvider({
      jobId: String(job.id),
      familyId: job.family_id == null ? null : String(job.family_id),
      userId: String(job.user_id),
      type: String(job.type),
      objectKey: String(job.object_key),
    });
  } catch (error) {
    await pool.query(
      "update ocr_domain.ocr_jobs set status='failed',progress=100,error_code=$2,updated_at=now(),version=version+1 where id=$1",
      [req.params.jobId, "OCR_PROVIDER_UNAVAILABLE"],
    );
    return fail(res, 502, "UPSTREAM_ERROR", error instanceof Error ? error.message : "OCR provider failed.");
  }

  const nextStatus = provider.provider === "disabled" || provider.confidence < 0.70 ? "needs_review" : "completed";
  const client2 = await pool.connect();
  try {
    await client2.query("begin");
    const existing = await client2.query("select id from ocr_domain.ocr_drafts where job_id=$1 for update", [req.params.jobId]);
    let draftId: string;
    if (existing.rowCount) {
      draftId = String(existing.rows[0].id);
      await client2.query(
        "update ocr_domain.ocr_drafts set confidence=$2,status='draft',raw_result=$3,updated_at=now(),version=version+1 where id=$1",
        [draftId, provider.confidence, JSON.stringify({provider:provider.provider,text:provider.text??null,warnings:provider.warnings,items:provider.items})],
      );
      await client2.query("delete from ocr_domain.ocr_draft_items where draft_id=$1", [draftId]);
    } else {
      const created = await client2.query(
        "insert into ocr_domain.ocr_drafts(job_id,confidence,status,raw_result) values($1,$2,'draft',$3) returning id",
        [req.params.jobId, provider.confidence, JSON.stringify({provider:provider.provider,text:provider.text??null,warnings:provider.warnings,items:provider.items})],
      );
      draftId = String(created.rows[0].id);
    }
    for (const item of provider.items) {
      await client2.query(
        "insert into ocr_domain.ocr_draft_items(draft_id,name,barcode,quantity,unit,price_minor,currency,confidence,product_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [draftId,item.name,item.barcode??null,item.quantity??null,item.unit??null,item.priceMinor??null,item.currency??null,item.confidence,item.productId??null],
      );
    }
    const updated = await client2.query(
      "update ocr_domain.ocr_jobs set status=$2,progress=100,error_code=null,updated_at=now(),version=version+1 where id=$1 returning *",
      [req.params.jobId,nextStatus],
    );
    await client2.query(
      "insert into ocr_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at) values($1,'OcrDraftReady',1,$2,$3,$4,now(),$5::jsonb,now())",
      [crypto.randomUUID(),req.params.jobId,updated.rows[0].family_id,crypto.randomUUID(),JSON.stringify({jobId:req.params.jobId,draftId,confidence:provider.confidence,provider:provider.provider,status:nextStatus})],
    );
    await client2.query("commit");
    return res.status(200).json({ data: ocrJobDto({...updated.rows[0],draft_id:draftId}), version: updated.rows[0].version });
  } catch (error) {
    await client2.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to persist OCR result.");
  } finally {
    client2.release();
  }
});

app.post("/api/v1/ocr/jobs", async (req, res) => {
  const actor = userId(req);
  if (!actor) return fail(res, 401, "UNAUTHENTICATED", "Authenticated user required.");
  if (String(req.header("content-type") ?? "").toLowerCase().split(";")[0] !== "multipart/form-data") {
    return fail(res, 400, "VALIDATION_ERROR", "multipart/form-data is required.");
  }

  let form: MultipartForm;
  try { form = await readMultipart(req); }
  catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_TOO_LARGE") return fail(res, 413, "PAYLOAD_TOO_LARGE", "File exceeds the 10 MB limit.");
    return fail(res, 400, "VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid multipart payload.");
  }

  const type = form.fields.type;
  const familyId = form.fields.familyId || null;
  const file = form.file;
  if (!file) return fail(res, 400, "VALIDATION_ERROR", "file is required.");
  if (!familyId) return fail(res, 400, "VALIDATION_ERROR", "familyId is required.");
  const familyAccess = await authorizeFamily(actor, familyId, true); if (!familyAccess.ok) return fail(res, familyAccess.status, familyAccess.code, familyAccess.message);
  if (type !== "receipt" && type !== "pantry_image") return fail(res, 400, "VALIDATION_ERROR", "type must be receipt or pantry_image.");
  if (!idempotencyKey(req)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, {
      type,
      familyId,
      filename: file.filename,
      size: file.buffer.length,
      mimeType: file.mimeType,
    }, familyId);
    if (idem.kind === "conflict") { await client.query("rollback"); return fail(res, 409, "CONFLICT", "Idempotency key conflict."); }
    if (idem.kind === "replay") { await client.query("commit"); return res.status(idem.status).json(idem.response); }

    const jobId = crypto.randomUUID();
    const objectKey = "ocr/" + jobId + "/source";
    if (!minioBucketReady) await ensureMinioBucket();
    await putMinioObject(objectKey, file.buffer, file.mimeType);

    await client.query(
      "insert into ocr_domain.ocr_jobs(id,user_id,family_id,type,object_key,status,progress) values($1,$2,$3,$4,$5,'queued',0)",
      [jobId, actor, familyId, type, objectKey],
    );
    const response = { data: { jobId, status: "queued", type, objectKey }, version: 1 };
    await finishIdempotency(client, req, 202, response);
    await client.query("commit");

    try {
      const { createClient } = await import("redis");
      const redis = createClient({ url: redisUrl });
      await redis.connect();
      await redis.lPush("q:ocr-processing", JSON.stringify({
        eventId: crypto.randomUUID(),
        eventType: "OCR_JOB_REQUESTED",
        data: { jobId, familyId, userId: actor, objectKey, type },
      }));
      await redis.quit();
    } catch (error) {
      console.error("ocr_enqueue_error", error);
    }

    return res.status(202).json(response);
  } catch (error) {
    await client.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to create OCR job.");
  } finally {
    client.release();
  }
});

app.get("/api/v1/ocr/jobs", async (req, res) => {
  const actor = userId(req);
  const family = String(req.query.familyId ?? req.header("x-family-id") ?? "").trim();
  const status = String(req.query.status ?? "").trim().toLowerCase();
  if (!actor) return fail(res, 401, "UNAUTHENTICATED", "Authenticated user required.");
  if (!family) return fail(res, 400, "VALIDATION_ERROR", "familyId is required.");
  const familyAccess = await authorizeFamily(actor, family, false); if (!familyAccess.ok) return fail(res, familyAccess.status, familyAccess.code, familyAccess.message);
  const allowed = ["queued","processing","completed","failed","cancelled","needs_review"];
  if (status && !allowed.includes(status)) return fail(res, 400, "VALIDATION_ERROR", "Invalid OCR status.");
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  try {
    const q = await pool.query(
      "select j.id,j.status,j.type,j.progress,j.error_code,j.version, coalesce((select d.id::text from ocr_domain.ocr_drafts d where d.job_id=j.id order by d.created_at desc limit 1),'') as draft_id from ocr_domain.ocr_jobs j where j.user_id=$1 and j.family_id=$2 and ($3='' or j.status=$3) order by j.created_at desc limit $4",
      [actor, family, status, limit],
    );
    return res.json({
      items: q.rows.map((row) => ({
        jobId: row.id,
        status: row.status,
        type: row.type,
        progress: Number(row.progress),
        draftId: row.draft_id || null,
        error: row.error_code ?? null,
      })),
      nextCursor: null,
    });
  } catch {
    return fail(res, 500, "INTERNAL_ERROR", "Unable to list OCR jobs.");
  }
});

app.get("/api/v1/ocr/jobs/:jobId", async (req, res) => {
  const actor = userId(req);
  if (!actor) return fail(res, 401, "UNAUTHENTICATED", "Authenticated user required.");
  const q = await pool.query(
    "select j.id,j.type,j.status,j.progress,j.error_code,(select d.id from ocr_domain.ocr_drafts d where d.job_id=j.id order by d.created_at desc limit 1) as draft_id from ocr_domain.ocr_jobs j where j.id=$1 and j.user_id=$2",
    [req.params.jobId, actor],
  );
  if (!q.rowCount) return fail(res,404,"NOT_FOUND","OCR job not found.");
  const row = q.rows[0];
  return res.json({data:{
    jobId: row.id,
    status: row.status,
    type: row.type,
    progress: Number(row.progress),
    draftId: row.draft_id ?? null,
    error: row.error_code ?? null,
  }});
});

app.get("/api/v1/ocr/drafts/:draftId", async (req,res) => {
  const actor=userId(req);
  if(!actor)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  const q=await pool.query("select d.*,j.user_id,j.type from ocr_domain.ocr_drafts d join ocr_domain.ocr_jobs j on j.id=d.job_id where d.id=$1 and j.user_id=$2",[req.params.draftId,actor]);
  if(!q.rowCount)return fail(res,404,"NOT_FOUND","OCR draft not found.");
  const row=q.rows[0];
  const items=await pool.query("select name,barcode,quantity,unit,price_minor,currency,confidence,product_id from ocr_domain.ocr_draft_items where draft_id=$1 order by id",[req.params.draftId]);
  return res.json({data:{
    draftId:row.id,
    jobId:row.job_id,
    type:row.type,
    confidence:Number(row.confidence),
    items:items.rows.map((item)=>({
      name:item.name,
      barcode:item.barcode,
      quantity:item.quantity===null?null:Number(item.quantity),
      unit:item.unit,
      priceMinor:item.price_minor===null?null:Number(item.price_minor),
      currency:item.currency,
      confidence:Number(item.confidence),
      ...(item.product_id?{productId:item.product_id}:{}),
    })),
  }});
});

app.post("/api/v1/ocr/drafts/:draftId/reject", async(req,res)=>{
  const actor=userId(req);
  if(!actor)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  if(!idempotencyKey(req))return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");
  const client=await pool.connect();
  try{await client.query("begin");
    const q=await client.query("select d.*,j.family_id from ocr_domain.ocr_drafts d join ocr_domain.ocr_jobs j on j.id=d.job_id where d.id=$1 and j.user_id=$2 for update",[req.params.draftId,actor]);
    if(!q.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","OCR draft not found.");}
    const idem=await beginIdempotency(client,req,req.body??{},q.rows[0].family_id);
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}
    const u=await client.query("update ocr_domain.ocr_drafts set status='rejected',updated_at=now(),version=version+1 where id=$1 returning *",[req.params.draftId]);
    const response={data:{draftId:u.rows[0].id,status:"rejected"},version:u.rows[0].version};
    await finishIdempotency(client,req,200,response);
    await client.query("commit");
    return res.json(response);
  }catch(e){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",e instanceof Error?e.message:"Unable to reject draft.");}
  finally{client.release();}
});

app.post("/api/v1/ocr/drafts/:draftId/confirm", async(req,res)=>{
  const actor=userId(req);
  if(!actor)return fail(res,401,"UNAUTHENTICATED","Authenticated user required.");
  if(!idempotencyKey(req))return fail(res,400,"VALIDATION_ERROR","X-Idempotency-Key is required.");
  const body=req.body as Body;
  if(!Array.isArray(body.items))return fail(res,400,"VALIDATION_ERROR","items is required.");
  const client=await pool.connect();
  try{await client.query("begin");
    const q=await client.query("select d.*,j.family_id from ocr_domain.ocr_drafts d join ocr_domain.ocr_jobs j on j.id=d.job_id where d.id=$1 and j.user_id=$2 for update",[req.params.draftId,actor]);
    if(!q.rowCount){await client.query("rollback");return fail(res,404,"NOT_FOUND","OCR draft not found.");}
    const idem=await beginIdempotency(client,req,body,q.rows[0].family_id);
    if(idem.kind==="conflict"){await client.query("rollback");return fail(res,409,"CONFLICT","Idempotency key conflict.");}
    if(idem.kind==="replay"){await client.query("commit");return res.status(idem.status).json(idem.response);}
    const u=await client.query("update ocr_domain.ocr_drafts set status='confirmed',raw_result=$2,updated_at=now(),version=version+1 where id=$1 returning *",[req.params.draftId,JSON.stringify(body)]);
    const response={data:{draftId:u.rows[0].id,status:"confirmed",applied:false},version:u.rows[0].version};
    await client.query(
      "insert into ocr_domain.outbox_events(event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at) values($1,'OcrDraftConfirmed',1,$2,$3,$4,now(),$5::jsonb,now())",
      [crypto.randomUUID(),req.params.draftId,q.rows[0].family_id,crypto.randomUUID(),JSON.stringify({draftId:req.params.draftId,items:body.items})],
    );
    await finishIdempotency(client,req,200,response);
    await client.query("commit");
    return res.json(response);
  }catch(e){await client.query("rollback");return fail(res,500,"INTERNAL_ERROR",e instanceof Error?e.message:"Unable to confirm draft.");}
  finally{client.release();}
});

app.use((_req,res)=>fail(res,404,"NOT_FOUND","Route not found."));

// MinIO è una dipendenza secondaria: se non è disponibile all'avvio (es. AIStor senza licenza, HTTP 403) il servizio
// parte comunque; il bucket viene riprovato al primo upload e solo la creazione di job OCR fallisce finché MinIO non funziona.
init()
  .then(() => ensureMinioBucket().catch((e) => console.warn(JSON.stringify({ service: "service-ocr", warning: "minio_unavailable_at_startup", message: e instanceof Error ? e.message : String(e) }))))
  .then(()=>app.listen(port,"0.0.0.0",()=>console.log(JSON.stringify({service:"service-ocr",port,bucket:minioBucket,minioReady:minioBucketReady}))))
  .catch(e=>{console.error(e);process.exit(1)});
