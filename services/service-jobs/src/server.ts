import express from "express"; import crypto from "node:crypto"; import { PostgresClient,resolveDatabaseUrl } from "./db/postgres-client.js"; import { OidcTokenVerifier } from "./identity/oidc.js"; import { JobAdministrationService } from "./jobs/admin.js"; import { PostgresJobAdminRepository,PostgresJobReplayPublisher,PostgresSecurityAuditWriter } from "./jobs/postgres.js"; import { buildJobsRouter } from "./http/routes/jobs.js"; import { corsMiddleware,requestMetaMiddleware } from "./http/middleware.js"; import { buildMeta,sendFailure } from "./http/envelope.js";
const port=Number(process.env.PORT??3317),app=express();app.use(corsMiddleware());app.use(requestMetaMiddleware());app.use(express.json({limit:'2mb'}));const pg=PostgresClient.create({connectionString:resolveDatabaseUrl()});const verifier=await OidcTokenVerifier.fromIssuer(process.env.OIDC_ISSUER!,process.env.OIDC_AUDIENCE!,fetch,{...(process.env.OIDC_DISCOVERY_URL ? {discoveryUrl:process.env.OIDC_DISCOVERY_URL} : {}),...(process.env.OIDC_JWKS_URL ? {jwksUrl:process.env.OIDC_JWKS_URL} : {})});const service=new JobAdministrationService(new PostgresJobAdminRepository(pg),new PostgresJobReplayPublisher(pg),new PostgresSecurityAuditWriter(pg),()=>crypto.randomUUID(),()=>Date.now());app.get('/health/live',(_q,res)=>res.json({status:'ok',service:'service-jobs'}));app.get('/health/ready',async(_q,res)=>{try{await pg.ping();res.json({status:'ready'})}catch{res.status(503).json({status:'not_ready'})}});const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";

function requireInternalToken(req: express.Request, res: express.Response): boolean {
  if (!internalServiceToken) {
    res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: "Internal jobs authentication is not configured.", retryable: true } });
    return false;
  }
  const expected = `Bearer ${internalServiceToken}`;
  if (req.header("authorization") !== expected) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Internal service authentication is required.", retryable: false } });
    return false;
  }
  return true;
}

app.post("/api/v1/internal/jobs", async (req, res) => {
  if (!requireInternalToken(req, res)) return;
  const body = req.body as Record<string, unknown>;
  const type = typeof body.type === "string" ? body.type.trim() : "";
  const deduplicationKey = typeof body.deduplicationKey === "string" ? body.deduplicationKey.trim() : "";
  const transportIdempotencyKey = String(req.header("x-idempotency-key") ?? "").trim();
  const payload = typeof body.payload === "object" && body.payload !== null && !Array.isArray(body.payload)
    ? body.payload
    : null;

  if (!type || !deduplicationKey || payload === null || transportIdempotencyKey.length < 8) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "type, payload, deduplicationKey and X-Idempotency-Key are required.", retryable: false } });
  }

  try {
    const existing = await pg.query<{ id: string; status: string; current_attempt: number; max_attempts: number; created_at: string }>(
      `SELECT id,status,current_attempt,max_attempts,created_at
       FROM jobs WHERE capability=$1 AND idempotency_key=$2`,
      [type, deduplicationKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return res.status(202).json({
        data: {
          jobId: row.id,
          type,
          status: row.status.toLowerCase(),
          attempt: row.current_attempt,
          maxAttempts: row.max_attempts,
          createdAt: row.created_at,
        },
      });
    }

    const jobId = crypto.randomUUID();
    const familyId =
      typeof (payload as Record<string, unknown>).familyId === "string"
        ? (payload as Record<string, unknown>).familyId
        : null;

    await pg.query(
      `INSERT INTO jobs
        (id,family_id,capability,status,idempotency_key,max_attempts,current_attempt,next_attempt_at,trace_id,payload)
       VALUES($1,$2,$3,'PENDING',$4,5,0,now(),$5,$6::jsonb)
       ON CONFLICT(capability,idempotency_key) DO NOTHING`,
      [jobId, familyId, type, deduplicationKey, req.header("x-request-id") ?? null, JSON.stringify(payload)],
    );

    const created = await pg.query<{ id: string; status: string; current_attempt: number; max_attempts: number; created_at: string }>(
      `SELECT id,status,current_attempt,max_attempts,created_at
       FROM jobs WHERE capability=$1 AND idempotency_key=$2`,
      [type, deduplicationKey],
    );
    const row = created.rows[0];
    if (!row) throw new Error("Job creation failed.");

    return res.status(202).json({
      data: {
        jobId: row.id,
        type,
        status: row.status.toLowerCase(),
        attempt: row.current_attempt,
        maxAttempts: row.max_attempts,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ service, event: "internal_job_create_failed", error: String(error) }));
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to create job.", retryable: false } });
  }
});

app.get("/api/v1/internal/jobs/:jobId", async (req, res) => {
  if (!requireInternalToken(req, res)) return;
  try {
    const result = await pg.query<{
      id: string;
      capability: string;
      status: string;
      current_attempt: number;
      max_attempts: number;
      created_at: string;
    }>(
      "SELECT id,capability,status,current_attempt,max_attempts,created_at FROM jobs WHERE id=$1",
      [req.params.jobId],
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Job not found.", retryable: false } });
    }
    return res.status(200).json({
      data: {
        jobId: row.id,
        type: row.capability,
        status: row.status.toLowerCase(),
        attempt: row.current_attempt,
        maxAttempts: row.max_attempts,
        createdAt: row.created_at,
      },
    });
  } catch {
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to read job.", retryable: false } });
  }
});

app.use('/api/v1',buildJobsRouter({service,verifier}));app.use((req,res)=>sendFailure(res,404,'NOT_FOUND_OR_NOT_VISIBLE','The resource is not available.',req.meta??buildMeta(req)));app.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({service:'service-jobs',port})));
