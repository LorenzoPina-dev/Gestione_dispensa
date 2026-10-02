import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { isExpirationSource, positiveQuantity, requiredIdempotencyKey, validIfMatch } from "./validation.js";

const port = Number(process.env.PORT ?? 3312);
const service = "service-inventory";
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://inventory:inventory@postgres:5432/inventory_db" });
const familyServiceBaseUrl = (process.env.FAMILY_SERVICE_BASE_URL ?? "http://service-family:3311/api/v1").replace(/\/$/, "");

type Ctx = { userId: string; familyId: string; requestId: string; correlationId: string };
type AuthResult = { ok: true } | { ok: false; status: number; code: string; message: string };

const send = (res: ServerResponse, status: number, body: unknown, requestId: string) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("x-request-id", requestId);
  res.end(JSON.stringify(body));
};

const fail = (res: ServerResponse, status: number, code: string, message: string, requestId: string) =>
  send(res, status, { error: { code, message, details: [], requestId } }, requestId);

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

function getContext(req: IncomingMessage): Ctx | null {
  const userId = String(req.headers["x-user-id"] ?? "");
  const familyId = String(req.headers["x-family-id"] ?? "");
  if (!userId || !familyId) return null;
  return {
    userId,
    familyId,
    requestId: String(req.headers["x-request-id"] ?? randomUUID()),
    correlationId: String(req.headers["x-correlation-id"] ?? randomUUID()),
  };
}

function dto(row: Record<string, unknown>) {
  return {
    itemId: row.id,
    productId: row.product_id,
    lotId: row.lot_id ?? null,
    quantity: Number(row.quantity),
    unit: row.unit,
    expiresAt: row.expires_at ?? null,
    expirationSource: row.expiration_source ?? null,
    location: row.location ?? null,
    lotCode: row.lot_code ?? null,
    addedAt: row.added_at,
    openedAt: row.opened_at ?? null,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

async function authorizeFamily(ctx: Ctx, write: boolean): Promise<AuthResult> {
  try {
    const response = await fetch(`${familyServiceBaseUrl}/families/${encodeURIComponent(ctx.familyId)}/members`, {
      headers: { "x-user-id": ctx.userId, accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." };
    const payload = (await response.json()) as { items?: Array<{ userId: string; role: string; status: string }> };
    const member = payload.items?.find((item) => item.userId === ctx.userId);
    if (!member || member.status !== "ACTIVE") return { ok: false, status: 403, code: "FORBIDDEN", message: "User is not an active member of the family." };
    if (write && member.role === "viewer") return { ok: false, status: 403, code: "FORBIDDEN", message: "Viewer role is read-only." };
    return { ok: true };
  } catch {
    return { ok: false, status: 503, code: "FAMILY_AUTH_UNAVAILABLE", message: "Family authorization service is unavailable." };
  }
}

const requestHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function idempotency(client: PoolClient, key: string, ctx: Ctx, body: unknown) {
  const hash = requestHash(body);
  const result = await client.query("SELECT * FROM idempotency_keys WHERE key=$1 FOR UPDATE", [key]);
  if (result.rowCount) {
    const row = result.rows[0];
    if (row.actor_user_id !== ctx.userId || row.request_hash !== hash) return { conflict: true as const };
    if (row.status === "completed") return { status: row.response_status as number, body: row.response_body as unknown };
    return null;
  }
  await client.query(
    "INSERT INTO idempotency_keys(key,actor_user_id,family_id,request_hash,status,created_at,expires_at) VALUES($1,$2,$3,$4,'processing',now(),now()+interval '24 hours')",
    [key, ctx.userId, ctx.familyId, hash],
  );
  return null;
}

async function finish(client: PoolClient, key: string, status: number, responseBody: unknown) {
  await client.query("UPDATE idempotency_keys SET status='completed',response_status=$2,response_body=$3 WHERE key=$1", [key, status, JSON.stringify(responseBody)]);
}

async function event(client: PoolClient, type: string, aggregateId: string, ctx: Ctx, payload: unknown) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO outbox_events(id,event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at) VALUES($1,$1,$2,1,$3,$4,$5,now(),$6,now())",
    [id, type, aggregateId, ctx.familyId, ctx.correlationId, JSON.stringify(payload)],
  );
}

const server = createServer(async (req, res) => {
  const requestId = String(req.headers["x-request-id"] ?? randomUUID());
  try {
    if (req.url === "/health/live") return send(res, 200, { status: "ok", service }, requestId);
    if (req.url === "/health/ready") {
      await pool.query("SELECT 1");
      return send(res, 200, { status: "ready", service }, requestId);
    }

    const ctx = getContext(req);
    if (!ctx) return fail(res, 401, "UNAUTHENTICATED", "Missing authenticated family context.", requestId);

    const url = new URL(req.url ?? "/", "http://inventory");
    const path = url.pathname;
    const itemMatch = path.match(/^\/api\/v1\/inventory\/([0-9a-f-]+)(?:\/(consume|waste|movements|expiration\/confirm))?$/i);

    if (req.method === "GET" && path === "/api/v1/inventory") {
      const auth = await authorizeFamily(ctx, false);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const result = await pool.query("SELECT * FROM pantry_items WHERE family_id=$1 ORDER BY added_at DESC LIMIT 100", [ctx.familyId]);
      return send(res, 200, { items: result.rows.map(dto), nextCursor: null }, ctx.requestId);
    }

    if (req.method === "GET" && itemMatch && !itemMatch[2]) {
      const auth = await authorizeFamily(ctx, false);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const result = await pool.query("SELECT * FROM pantry_items WHERE id=$1 AND family_id=$2", [itemMatch[1], ctx.familyId]);
      return result.rowCount ? send(res, 200, { data: dto(result.rows[0]) }, ctx.requestId) : fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId);
    }

    if (req.method === "GET" && itemMatch?.[2] === "movements") {
      const auth = await authorizeFamily(ctx, false);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const result = await pool.query("SELECT id,product_id,type,quantity,unit,reason,occurred_at,actor_user_id FROM movements WHERE pantry_item_id=$1 AND family_id=$2 ORDER BY occurred_at DESC LIMIT 100", [itemMatch[1], ctx.familyId]);
      return send(res, 200, { items: result.rows.map((row) => ({ movementId: row.id, productId: row.product_id, type: row.type, quantity: Number(row.quantity), unit: row.unit, reason: row.reason, occurredAt: row.occurred_at, actorUserId: row.actor_user_id })), nextCursor: null }, ctx.requestId);
    }

    if (req.method === "POST" && path === "/api/v1/inventory/items") {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const quantity = positiveQuantity(body.quantity);
      if (!body.productId || !body.unit || quantity === undefined) return fail(res, 400, "VALIDATION_ERROR", "productId, unit and positive quantity are required.", ctx.requestId);
      const key = String(req.headers["x-idempotency-key"] ?? "");
      if (!key) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const id = randomUUID();
        const result = await client.query("INSERT INTO pantry_items(id,family_id,product_id,quantity,unit,location,expires_at,expiration_source,lot_code,added_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),now()) RETURNING *", [id, ctx.familyId, String(body.productId), quantity, String(body.unit), body.location ?? null, body.expiresAt ? new Date(String(body.expiresAt)) : null, body.expiresAt ? "declared" : null, body.lotCode ?? null]);
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,'add',$5,$6,'added',$7,now(),now())", [randomUUID(), ctx.familyId, id, body.productId, quantity, body.unit, ctx.userId]);
        await event(client, "PantryItemAdjusted", id, ctx, { action: "add", item: dto(result.rows[0]) });
        const output = { data: dto(result.rows[0]), version: Number(result.rows[0].version) };
        await finish(client, key, 201, output);
        await client.query("COMMIT");
        return send(res, 201, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }

    if (req.method === "POST" && itemMatch?.[2] && ["consume", "waste"].includes(itemMatch[2])) {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const quantity = positiveQuantity(body.quantity);
      const key = String(req.headers["x-idempotency-key"] ?? "");
      const ifMatch = String(req.headers["if-match"] ?? "");
      if (!key || !Number.isFinite(quantity) || quantity <= 0) return fail(res, 400, "VALIDATION_ERROR", "Positive quantity and X-Idempotency-Key are required.", ctx.requestId);
      if (!/^\d+$/.test(ifMatch) || Number(ifMatch) < 1) return fail(res, 428, "PRECONDITION_REQUIRED", "If-Match is required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const result = await client.query("SELECT * FROM pantry_items WHERE id=$1 AND family_id=$2 FOR UPDATE", [itemMatch[1], ctx.familyId]);
        if (!result.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId); }
        const row = result.rows[0];
        if (Number(row.version) !== Number(ifMatch)) { await client.query("ROLLBACK"); return fail(res, 412, "VERSION_CONFLICT", "Item version changed.", ctx.requestId); }
        const remaining = Number(row.quantity) - quantity;
        if (remaining < 0) { await client.query("ROLLBACK"); return fail(res, 422, "BUSINESS_RULE_VIOLATION", "Quantity exceeds available inventory.", ctx.requestId); }
        const removed = remaining === 0;
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())", [randomUUID(), ctx.familyId, removed ? null : row.id, row.product_id, itemMatch[2] === "consume" ? "consume" : "waste", quantity, row.unit, body.reason ?? null, ctx.userId]);
        if (removed) await client.query("DELETE FROM pantry_items WHERE id=$1 AND family_id=$2", [row.id, ctx.familyId]);
        else await client.query("UPDATE pantry_items SET quantity=$3,updated_at=now(),version=version+1 WHERE id=$1 AND family_id=$2", [row.id, ctx.familyId, remaining]);
        await event(client, "PantryItemAdjusted", row.id, ctx, { action: itemMatch[2], productId: row.product_id, quantity, remainingQuantity: remaining, removed });
        const output = { data: { itemId: row.id, ...(itemMatch[2] === "consume" ? { consumedQuantity: quantity } : { wastedQuantity: quantity }), remainingQuantity: remaining, removed }, version: Number(row.version) + 1 };
        await finish(client, key, 200, output);
        await client.query("COMMIT");
        return send(res, 200, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }

    if (req.method === "POST" && itemMatch?.[2] === "expiration/confirm") {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const key = String(req.headers["x-idempotency-key"] ?? "");
      const source = String(body.source ?? "");
      if (!requiredIdempotencyKey(key) || !body.expiresAt || !isExpirationSource(source)) return fail(res, 400, "VALIDATION_ERROR", "expiresAt, source and X-Idempotency-Key are required.", ctx.requestId);
      const expiresAt = new Date(String(body.expiresAt));
      if (Number.isNaN(expiresAt.getTime())) return fail(res, 400, "VALIDATION_ERROR", "expiresAt is invalid.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const result = await client.query("UPDATE pantry_items SET expires_at=$3,expiration_source=$4,updated_at=now(),version=version+1 WHERE id=$1 AND family_id=$2 RETURNING *", [itemMatch[1], ctx.familyId, expiresAt, source]);
        if (!result.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId); }
        const output = { data: dto(result.rows[0]), version: Number(result.rows[0].version) };
        await event(client, "PantryItemAdjusted", itemMatch[1], ctx, { action: "expiration_confirmed", item: output.data });
        await finish(client, key, 200, output);
        await client.query("COMMIT");
        return send(res, 200, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }

    return fail(res, 404, "NOT_FOUND", "Route not found.", ctx.requestId);
  } catch (error) {
    console.error(JSON.stringify({ service, event: "request.failed", error: error instanceof Error ? error.message : String(error) }));
    return fail(res, 500, "INTERNAL_ERROR", "Unexpected internal error.", requestId);
  }
});

server.on("error", (error) => {
  console.error(JSON.stringify({ service, event: "server.error", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});

server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ service, port })));
