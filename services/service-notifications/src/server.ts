import express, { type Request, type Response } from "express";
import { Pool, type PoolClient } from "pg";
import crypto from "node:crypto";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const port = Number(process.env.PORT ?? 3315);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Body = Record<string, unknown>;

function fail(res: Response, status: number, code: string, message: string): Response {
  return res.status(status).json({
    error: { code, message, details: [], requestId: crypto.randomUUID() },
  });
}

function actor(req: Request): string {
  return String(req.header("x-user-id") ?? "").trim();
}

function family(req: Request): string | null {
  return String(req.query.familyId ?? req.body?.familyId ?? req.header("x-family-id") ?? "").trim() || null;
}

function key(req: Request): string | null {
  const value = String(req.header("x-idempotency-key") ?? "").trim();
  return value.length >= 8 ? value : null;
}

function requestHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function beginIdempotency(client: PoolClient, req: Request, body: unknown) {
  const idempotencyKey = key(req);
  const userId = actor(req);
  if (!idempotencyKey || !userId) return { kind: "missing" as const };

  const familyId = family(req);
  const hash = requestHash(body);
  const existing = await client.query(
    "select actor_user_id,family_id,request_hash,status,response_status,response_body from notifications_domain.idempotency_keys where key=$1 for update",
    [idempotencyKey],
  );

  if (existing.rowCount) {
    const row = existing.rows[0];
    if (String(row.actor_user_id) !== userId || String(row.family_id ?? "") !== String(familyId ?? "") || row.request_hash !== hash) {
      return { kind: "conflict" as const };
    }
    if (row.status === "completed") {
      return { kind: "replay" as const, status: Number(row.response_status), response: row.response_body };
    }
    return { kind: "new" as const };
  }

  await client.query(
    `insert into notifications_domain.idempotency_keys
      (key,actor_user_id,family_id,request_hash,status,created_at,expires_at)
     values($1,$2,$3,$4,'processing',now(),now()+interval '24 hours')`,
    [idempotencyKey, userId, familyId, hash],
  );
  return { kind: "new" as const };
}

async function finishIdempotency(client: PoolClient, req: Request, status: number, response: unknown) {
  const idempotencyKey = key(req);
  if (!idempotencyKey) return;
  await client.query(
    "update notifications_domain.idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [idempotencyKey, status, JSON.stringify(response)],
  );
}

async function emitOutbox(client: PoolClient, type: string, aggregateId: string, familyId: string | null, userId: string, payload: unknown) {
  await client.query(
    `insert into notifications_domain.outbox_events
      (event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
     values($1,$2,1,$3,$4,$5,now(),$6::jsonb,now())`,
    [crypto.randomUUID(), type, aggregateId, familyId, crypto.randomUUID(), JSON.stringify({ actorUserId: userId, payload })],
  );
}

async function init(): Promise<void> {
  await pool.query("select 1");
}

app.get("/health/live", (_req, res) => res.json({ status: "ok", service: "service-notifications" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ready", service: "service-notifications" });
  } catch {
    res.status(503).json({ status: "not_ready", service: "service-notifications" });
  }
});

app.get("/api/v1/notifications", async (req, res) => {
  const userId = actor(req);
  const familyId = family(req);
  if (!userId || !familyId) return fail(res, 400, "VALIDATION_ERROR", "familyId and authenticated user are required.");
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
  const unreadOnly = req.query.unreadOnly === "true";

  const q = await pool.query(
    `select id,type,title,body,payload,read_at,created_at,expires_at,version
     from notifications_domain.notifications
     where family_id=$1 and user_id=$2 and ($3=false or read_at is null)
       and (expires_at is null or expires_at > now())
     order by created_at desc limit $4`,
    [familyId, userId, unreadOnly, limit],
  );

  return res.json({
    items: q.rows.map((row) => ({
      notificationId: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      ...(row.payload ? { payload: row.payload } : {}),
      readAt: row.read_at,
      createdAt: row.created_at,
      version: row.version,
    })),
    nextCursor: null,
  });
});

app.post("/api/v1/notifications/:notificationId/read", async (req, res) => {
  const userId = actor(req);
  const familyId = family(req);
  if (!userId || !familyId) return fail(res, 400, "VALIDATION_ERROR", "familyId and authenticated user are required.");
  if (!key(req)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, req.body ?? {});
    if (idem.kind === "missing") { await client.query("rollback"); return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required."); }
    if (idem.kind === "conflict") { await client.query("rollback"); return fail(res, 409, "CONFLICT", "Idempotency key conflict."); }
    if (idem.kind === "replay") { await client.query("commit"); return res.status(idem.status).json(idem.response); }

    const q = await client.query(
      `update notifications_domain.notifications
       set read_at=coalesce(read_at,now()),version=version+1
       where id=$1 and family_id=$2 and user_id=$3
       returning *`,
      [req.params.notificationId, familyId, userId],
    );
    if (!q.rowCount) { await client.query("rollback"); return fail(res, 404, "NOT_FOUND", "Notification not found."); }

    const row = q.rows[0];
    const response = {
      data: {
        notificationId: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        ...(row.payload ? { payload: row.payload } : {}),
        readAt: row.read_at,
        createdAt: row.created_at,
      },
      version: row.version,
    };

    await emitOutbox(client, "NotificationRead", row.id, familyId, userId, response);
    await finishIdempotency(client, req, 200, response);
    await client.query("commit");
    return res.json(response);
  } catch (error) {
    await client.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to mark notification as read.");
  } finally {
    client.release();
  }
});

app.get("/api/v1/notifications/preferences", async (req, res) => {
  const userId = actor(req);
  if (!userId) return fail(res, 401, "UNAUTHENTICATED", "Authenticated user required.");
  const q = await pool.query(
    `insert into notifications_domain.preferences(user_id) values($1)
     on conflict(user_id) do update set updated_at=notifications_domain.preferences.updated_at
     returning *`,
    [userId],
  );
  const row = q.rows[0];
  return res.json({
    data: {
      expiration: row.expiration,
      lowStock: row.low_stock,
      offers: row.offers,
      family: row.family,
      system: row.system,
      channels: { inApp: row.in_app, email: row.email, push: row.push },
      version: row.version,
    },
  });
});

app.put("/api/v1/notifications/preferences", async (req, res) => {
  const userId = actor(req);
  if (!userId) return fail(res, 401, "UNAUTHENTICATED", "Authenticated user required.");
  if (!key(req)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.");
  const body = req.body as Body;
  const channels = typeof body.channels === "object" && body.channels !== null
    ? body.channels as Record<string, unknown>
    : {};
  const bool = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const idem = await beginIdempotency(client, req, body);
    if (idem.kind === "missing") { await client.query("rollback"); return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required."); }
    if (idem.kind === "conflict") { await client.query("rollback"); return fail(res, 409, "CONFLICT", "Idempotency key conflict."); }
    if (idem.kind === "replay") { await client.query("commit"); return res.status(idem.status).json(idem.response); }

    const current = await client.query("select * from notifications_domain.preferences where user_id=$1 for update", [userId]);
    const existing = current.rows[0];
    const value = {
      expiration: bool(body.expiration) ?? existing?.expiration ?? true,
      lowStock: bool(body.lowStock) ?? existing?.low_stock ?? true,
      offers: bool(body.offers) ?? existing?.offers ?? false,
      family: bool(body.family) ?? existing?.family ?? true,
      system: bool(body.system) ?? existing?.system ?? true,
      inApp: bool(channels.inApp) ?? existing?.in_app ?? true,
      email: bool(channels.email) ?? existing?.email ?? false,
      push: bool(channels.push) ?? existing?.push ?? false,
    };

    const q = await client.query(
      `insert into notifications_domain.preferences(user_id,expiration,low_stock,offers,family,system,in_app,email,push)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict(user_id) do update set
         expiration=excluded.expiration,low_stock=excluded.low_stock,offers=excluded.offers,
         family=excluded.family,system=excluded.system,in_app=excluded.in_app,
         email=excluded.email,push=excluded.push,updated_at=now(),
         version=notifications_domain.preferences.version+1
       returning *`,
      [userId,value.expiration,value.lowStock,value.offers,value.family,value.system,value.inApp,value.email,value.push],
    );

    const row = q.rows[0];
    const response = {
      data: {
        expiration: row.expiration,
        lowStock: row.low_stock,
        offers: row.offers,
        family: row.family,
        system: row.system,
        channels: { inApp: row.in_app, email: row.email, push: row.push },
        version: row.version,
      },
      version: row.version,
    };

    await finishIdempotency(client, req, 200, response);
    await client.query("commit");
    return res.json(response);
  } catch (error) {
    await client.query("rollback");
    return fail(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : "Unable to update notification preferences.");
  } finally {
    client.release();
  }
});

app.use((_req, res) => fail(res, 404, "NOT_FOUND", "Route not found."));

init().then(() => app.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ service: "service-notifications", port }))))
  .catch((error) => { console.error(error); process.exit(1); });
