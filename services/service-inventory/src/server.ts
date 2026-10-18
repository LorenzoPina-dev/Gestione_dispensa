import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createContextAwarePool, setDbRequestContextFromHeaders, type PoolClient } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { createClient } from "redis";
import { CONSUME_REASONS, isConsumeReason, isExpirationSource, positiveQuantity, requiredIdempotencyKey, validIfMatch, validIsoDate, validOptionalText } from "./validation.js";

const port = Number(process.env.PORT ?? 3312);
const service = "service-inventory";
const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL ?? "postgres://inventory:inventory@postgres:5432/inventory_db" });
function normalizeFamilyServiceBaseUrl(value: string | undefined): string {
  const base = (value ?? "http://service-family:3311").replace(/\/$/, "");
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}

const familyServiceBaseUrl = normalizeFamilyServiceBaseUrl(process.env.FAMILY_SERVICE_BASE_URL);

type DomainEvent = {
  eventId: string;
  eventType: string;
  familyId?: string | null;
  correlationId?: string;
  payload?: Record<string, unknown>;
};

const eventRedis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const eventStream = process.env.EVENT_STREAM ?? "events:domain";
const eventGroup = process.env.EVENT_CONSUMER_GROUP ?? "inventory";
const eventConsumer = process.env.EVENT_CONSUMER_NAME ?? `inventory-${process.pid}`;

async function enableInternalDbScope(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.internal_service','true',true)");
}

async function consumeShelfLifeEvents(): Promise<void> {
  await eventRedis.connect();
  await eventRedis.xGroupCreate(eventStream, eventGroup, process.env.EVENT_GROUP_START_ID ?? "0-0", { MKSTREAM: true }).catch((error: unknown) => {
    if (!String(error).includes("BUSYGROUP")) throw error;
  });

  let claimCursor = "0-0";
  while (true) {
    const claimed = await eventRedis.xAutoClaim(eventStream, eventGroup, eventConsumer, 30_000, claimCursor, { COUNT: 10 });
    claimCursor = claimed.nextId ?? "0-0";
    const fresh = await eventRedis.xReadGroup(eventGroup, eventConsumer, [{ key: eventStream, id: ">" }], { COUNT: 10, BLOCK: 1000 });
    const result = [{ key: eventStream, messages: [...(claimed.messages ?? []), ...(fresh?.[0]?.messages ?? [])] }];
    for (const streamResult of result) {
      for (const message of streamResult.messages) {
        const client = await pool.connect();
        try {
          const domainEvent = JSON.parse(String(message.message.event)) as DomainEvent;
          if (domainEvent.eventType !== "shelf-life.prediction-completed.v1") {
            await eventRedis.xAck(eventStream, eventGroup, message.id);
            continue;
          }
          const payload = domainEvent.payload ?? {};
          const familyId = typeof domainEvent.familyId === "string" ? domainEvent.familyId : "";
          const itemId = typeof payload.itemId === "string" ? payload.itemId : "";
          const productId = typeof payload.productId === "string" ? payload.productId : "";
          const expiresAt = typeof payload.estimatedExpiresAt === "string" ? payload.estimatedExpiresAt : "";
          if (!domainEvent.eventId || !familyId || !itemId || !productId || !expiresAt) throw new Error("Invalid shelf-life.prediction-completed.v1 payload.");

          await client.query("BEGIN");
          await enableInternalDbScope(client);
          const processed = await client.query(
            `INSERT INTO event_consumers(event_id,event_type) VALUES($1,$2)
             ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,
            [domainEvent.eventId, domainEvent.eventType],
          );
          if (!processed.rowCount) {
            await client.query("COMMIT");
            await eventRedis.xAck(eventStream, eventGroup, message.id);
            continue;
          }

          const updated = await client.query(
            `UPDATE pantry_items
                SET expires_at=$1,
                    expiration_source='estimated',
                    version=version+1,
                    updated_at=now()
              WHERE id=$2 AND family_id=$3
                AND (expiration_source IS NULL OR expiration_source <> 'declared')
              RETURNING id,product_id,expires_at`,
            [new Date(expiresAt).toISOString(), itemId, familyId],
          );

          if (updated.rowCount) {
            await event(client, "inventory.expiration-confirmed.v1", itemId, {
              userId: "system",
              familyId,
              requestId: domainEvent.eventId,
              correlationId: domainEvent.correlationId ?? randomUUID(),
            }, {
              itemId,
              productId,
              expiresAt: new Date(expiresAt).toISOString(),
              source: "estimated",
            });
            console.log(JSON.stringify({
              service,
              event: "shelf_life_expiration_applied",
              messageId: message.id,
              itemId,
              productId,
              familyId,
              expiresAt: new Date(expiresAt).toISOString(),
            }));
          } else {
            console.warn(JSON.stringify({
              service,
              event: "shelf_life_expiration_not_applied",
              messageId: message.id,
              itemId,
              productId,
              familyId,
              expiresAt,
              reason: "inventory_item_not_found_or_declared_expiration",
            }));
          }
          await client.query("COMMIT");
          await eventRedis.xAck(eventStream, eventGroup, message.id);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          console.error(JSON.stringify({
            service: "service-inventory",
            event: "shelf_life_event_processing_failed",
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          }));
        } finally {
          client.release();
        }
      }
    }
  }
}

type Ctx = { userId: string; familyId: string; requestId: string; correlationId: string };
type AuthResult = { ok: true } | { ok: false; status: number; code: string; message: string };

const send = (res: ServerResponse, status: number, body: unknown, requestId: string) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("x-request-id", requestId);
  res.end(JSON.stringify(body));
};

const fail = (res: ServerResponse, status: number, code: string, message: string, requestId: string) => {
  const retryable = ["UPSTREAM_ERROR", "SERVICE_UNAVAILABLE", "UPSTREAM_TIMEOUT", "INTERNAL_ERROR"].includes(code);
  return send(res, status, {
    error: { code, message, details: [], retryable, requestId },
    meta: { requestId, traceId: requestId, schemaVersion: "1.0" },
  }, requestId);
};

class RequestBodyValidationError extends Error {}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new RequestBodyValidationError("Request body must be valid JSON."); }
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

function pagination(url: URL): { limit: number; offset: number } {
  const parsedLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 100;
  const cursor = url.searchParams.get("cursor");
  const parsedCursor = cursor === null ? 0 : Number(cursor);
  const offset = Number.isInteger(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  return { limit, offset };
}


function isoDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
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
    remainingContentQuantity: row.remaining_content_quantity == null ? null : Number(row.remaining_content_quantity),
    remainingContentUnit: row.remaining_content_unit ?? null,
    updatedAt: row.updated_at,
    version: Number(row.version),
    ...(row.reorder_point == null ? {} : { reorderPoint: Number(row.reorder_point) }),
    ...(row.reorder_quantity == null ? {} : { reorderQuantity: Number(row.reorder_quantity) }),
  };
}
function reorderPolicyDto(row: Record<string, unknown>) {
  return {
    productId: String(row.product_id),
    reorderPoint: Number(row.reorder_point),
    reorderQuantity: Number(row.reorder_quantity),
    unit: String(row.unit),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

type ReorderState = {
  productId: string;
  availableQuantity: number;
  reorderPoint: number;
  reorderQuantity: number;
  unit: string;
};

async function readReorderState(client: PoolClient, familyId: string, productId: string): Promise<ReorderState | null> {
  const result = await client.query(
    `SELECT p.product_id,p.reorder_point,p.reorder_quantity,p.unit,
            COALESCE(SUM(i.quantity),0) AS available_quantity
       FROM reorder_policies p
       LEFT JOIN pantry_items i
         ON i.family_id=p.family_id
        AND i.product_id=p.product_id
        AND i.unit=p.unit
      WHERE p.family_id=$1 AND p.product_id=$2 AND p.enabled=true
      GROUP BY p.family_id,p.product_id,p.reorder_point,p.reorder_quantity,p.unit`,
    [familyId, productId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    productId: String(row.product_id),
    availableQuantity: Number(row.available_quantity),
    reorderPoint: Number(row.reorder_point),
    reorderQuantity: Number(row.reorder_quantity),
    unit: String(row.unit),
  };
}

async function emitReorderTransition(client: PoolClient, ctx: Ctx, before: ReorderState | null, after: ReorderState | null): Promise<void> {
  if (!after && before) {
    await event(client, "PantryReorderPolicyDisabled", before.productId, ctx, { productId: before.productId });
    return;
  }
  if (!after) return;
  const beforeLow = before ? before.availableQuantity <= before.reorderPoint : false;
  const afterLow = after.availableQuantity <= after.reorderPoint;
  const policyChanged = before !== null && (
    before.reorderPoint !== after.reorderPoint ||
    before.reorderQuantity !== after.reorderQuantity ||
    before.unit !== after.unit
  );
  if (afterLow && (!beforeLow || policyChanged)) {
    await event(client, "PantryLowStock", after.productId, ctx, {
      productId: after.productId,
      availableQuantity: after.availableQuantity,
      reorderPoint: after.reorderPoint,
      reorderQuantity: after.reorderQuantity,
      unit: after.unit,
      reason: before ? "THRESHOLD_REACHED" : "POLICY_ACTIVATED",
      dedupeKey: `${ctx.familyId}:${after.productId}`,
    });
  } else if (!afterLow && beforeLow) {
    await event(client, "PantryStockReplenished", after.productId, ctx, {
      productId: after.productId,
      availableQuantity: after.availableQuantity,
      reorderPoint: after.reorderPoint,
      reorderQuantity: after.reorderQuantity,
      unit: after.unit,
      reason: "ABOVE_THRESHOLD",
    });
  }
}

async function upsertReorderPolicy(client: PoolClient, ctx: Ctx, productId: string, reorderPoint: number, reorderQuantity: number, unit: string): Promise<void> {
  await client.query(
    `INSERT INTO reorder_policies(family_id,product_id,reorder_point,reorder_quantity,unit,enabled)
     VALUES($1,$2,$3,$4,$5,true)
     ON CONFLICT (family_id,product_id) DO UPDATE SET
       reorder_point=EXCLUDED.reorder_point,
       reorder_quantity=EXCLUDED.reorder_quantity,
       unit=EXCLUDED.unit,
       enabled=true,
       updated_at=now(),
       version=reorder_policies.version+1`,
    [ctx.familyId, productId, reorderPoint, reorderQuantity, unit],
  );
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

/**
 * Scala `quantity` da una riga della dispensa già bloccata (FOR UPDATE).
 * pantry_items.quantity ha CHECK (quantity > 0): quando la giacenza si esaurisce la riga va eliminata
 * (lo storico resta in `movements`), altrimenti l'UPDATE a 0 viola il vincolo e l'endpoint risponde 500.
 * Restituisce la stessa forma di `client.query` così i chiamanti usano `updated.rows[0]` come prima.
 */
async function applyOutflow(
  client: PoolClient,
  row: Record<string, unknown>,
  quantity: number,
  ctx: Ctx,
): Promise<{ rows: Array<Record<string, unknown>> }> {
  const remaining = Math.round((Number(row.quantity) - quantity) * 1000) / 1000;
  if (remaining <= 0) {
    const removed = await client.query("DELETE FROM pantry_items WHERE id=$1 AND family_id=$2 RETURNING *", [row.id, ctx.familyId]);
    const gone = removed.rows[0] as Record<string, unknown>;
    return { rows: [{ ...gone, quantity: 0, version: Number(gone.version) + 1, updated_at: new Date().toISOString() }] };
  }
  return client.query("UPDATE pantry_items SET quantity=quantity-$1,version=version+1,updated_at=now() WHERE id=$2 AND family_id=$3 RETURNING *", [quantity, row.id, ctx.familyId]);
}

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
  setDbRequestContextFromHeaders(req.headers);
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
    const reorderPolicyMatch = path.match(/^\/api\/v1\/inventory\/reorder-policies\/([0-9a-f-]+)$/i);

    if (req.method === "GET" && path === "/api/v1/inventory") {
      const auth = await authorizeFamily(ctx, false);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const status = url.searchParams.get("status") ?? "current";
      if (status !== "current") return fail(res, 400, "VALIDATION_ERROR", "status must be current.", ctx.requestId);
      const { limit, offset } = pagination(url);
      const result = await pool.query("SELECT i.*, p.reorder_point, p.reorder_quantity FROM pantry_items i LEFT JOIN reorder_policies p ON p.family_id=i.family_id AND p.product_id=i.product_id AND p.enabled=true WHERE i.family_id=$1 ORDER BY i.added_at DESC LIMIT $2 OFFSET $3", [ctx.familyId, limit + 1, offset]);
      const hasNext = result.rows.length > limit;
      const rows = hasNext ? result.rows.slice(0, limit) : result.rows;
      return send(res, 200, { items: rows.map(dto), nextCursor: hasNext ? String(offset + limit) : null }, ctx.requestId);
    }

    if (req.method === "GET" && path === "/api/v1/inventory/reorder-policies") {
      const auth = await authorizeFamily(ctx, false);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const result = await pool.query("SELECT * FROM reorder_policies WHERE family_id=$1 AND enabled=true ORDER BY updated_at DESC", [ctx.familyId]);
      return send(res, 200, { items: result.rows.map((row) => reorderPolicyDto(row)), nextCursor: null }, ctx.requestId);
    }

    if (req.method === "PUT" && reorderPolicyMatch) {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      if (!Object.hasOwn(body, "reorderPoint")) return fail(res, 400, "VALIDATION_ERROR", "reorderPoint is required.", ctx.requestId);
      if (body.reorderPoint !== null && (typeof body.reorderPoint !== "number" || !Number.isFinite(body.reorderPoint) || body.reorderPoint < 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderPoint must be a non-negative number or null.", ctx.requestId);
      if (body.reorderQuantity !== undefined && (typeof body.reorderQuantity !== "number" || !Number.isFinite(body.reorderQuantity) || body.reorderQuantity <= 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderQuantity must be a positive number.", ctx.requestId);
      if (body.unit !== undefined && (typeof body.unit !== "string" || !body.unit.trim())) return fail(res, 400, "VALIDATION_ERROR", "unit must be a non-empty string.", ctx.requestId);
      const key = String(req.headers["x-idempotency-key"] ?? "").trim();
      if (!requiredIdempotencyKey(key)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const productId = reorderPolicyMatch[1];
        const before = await readReorderState(client, ctx.familyId, productId);
        const existing = await client.query("SELECT * FROM reorder_policies WHERE family_id=$1 AND product_id=$2 FOR UPDATE", [ctx.familyId, productId]);
        if (body.reorderPoint === null) {
          await client.query("DELETE FROM reorder_policies WHERE family_id=$1 AND product_id=$2", [ctx.familyId, productId]);
          await emitReorderTransition(client, ctx, before, null);
          const response = { data: null, version: Number(existing.rows[0]?.version ?? 0) };
          await finish(client, key, 200, response);
          await client.query("COMMIT");
          return send(res, 200, response, ctx.requestId);
        }
        const point = Number(body.reorderPoint);
        const quantity = body.reorderQuantity == null ? Number(existing.rows[0]?.reorder_quantity ?? 1) : Number(body.reorderQuantity);
        const unit = body.unit == null ? String(existing.rows[0]?.unit ?? "piece") : String(body.unit);
        await upsertReorderPolicy(client, ctx, productId, point, quantity, unit);
        const after = await readReorderState(client, ctx.familyId, productId);
        await emitReorderTransition(client, ctx, before, after);
        const saved = await client.query("SELECT * FROM reorder_policies WHERE family_id=$1 AND product_id=$2", [ctx.familyId, productId]);
        const response = { data: reorderPolicyDto(saved.rows[0]), version: Number(saved.rows[0].version) };
        await finish(client, key, 200, response);
        await client.query("COMMIT");
        return send(res, 200, response, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
    if (req.method === "GET" && itemMatch && !itemMatch[2]) {
      const auth = await authorizeFamily(ctx, false);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const result = await pool.query("SELECT i.*, p.reorder_point, p.reorder_quantity FROM pantry_items i LEFT JOIN reorder_policies p ON p.family_id=i.family_id AND p.product_id=i.product_id AND p.enabled=true WHERE i.id=$1 AND i.family_id=$2", [itemMatch[1], ctx.familyId]);
      return result.rowCount ? send(res, 200, { data: dto(result.rows[0]) }, ctx.requestId) : fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId);
    }

    if (req.method === "GET" && itemMatch?.[2] === "movements") {
      const auth = await authorizeFamily(ctx, false);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const { limit, offset } = pagination(url);
      const result = await pool.query("SELECT id,product_id,type,quantity,unit,reason,occurred_at,actor_user_id FROM movements WHERE pantry_item_id=$1 AND family_id=$2 ORDER BY occurred_at DESC LIMIT $3 OFFSET $4", [itemMatch[1], ctx.familyId, limit + 1, offset]);
      const hasNext = result.rows.length > limit;
      const rows = hasNext ? result.rows.slice(0, limit) : result.rows;
      return send(res, 200, { items: rows.map((row) => ({ movementId: row.id, productId: row.product_id, type: row.type, quantity: Number(row.quantity), unit: row.unit, reason: row.reason, occurredAt: row.occurred_at, actorUserId: row.actor_user_id })), nextCursor: hasNext ? String(offset + limit) : null }, ctx.requestId);
    }

    if (req.method === "POST" && path === "/api/v1/inventory/items") {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const quantity = positiveQuantity(body.quantity);
      const allowedFields = ["productId", "quantity", "unit", "expiresAt", "location", "lotCode", "openedAt", "remainingContentQuantity", "remainingContentUnit", "reorderPoint", "reorderQuantity"];
      if (Object.keys(body).some((field) => !allowedFields.includes(field))) return fail(res, 400, "VALIDATION_ERROR", "Unknown inventory field.", ctx.requestId);
      if (!body.productId || !body.unit || quantity === undefined) return fail(res, 400, "VALIDATION_ERROR", "productId, unit and positive quantity are required.", ctx.requestId);
      if (body.expiresAt !== undefined && !validIsoDate(body.expiresAt)) return fail(res, 400, "VALIDATION_ERROR", "expiresAt is invalid.", ctx.requestId);
      if (body.openedAt !== undefined && body.openedAt !== null && !validIsoDate(body.openedAt)) return fail(res, 400, "VALIDATION_ERROR", "openedAt is invalid.", ctx.requestId);
      if (Object.hasOwn(body, "remainingContentQuantity") !== Object.hasOwn(body, "remainingContentUnit")) return fail(res, 400, "VALIDATION_ERROR", "remainingContentQuantity and remainingContentUnit must be updated together.", ctx.requestId);
      if (body.remainingContentQuantity !== undefined && body.remainingContentQuantity !== null && (typeof body.remainingContentQuantity !== "number" || !Number.isFinite(body.remainingContentQuantity) || body.remainingContentQuantity <= 0)) return fail(res, 400, "VALIDATION_ERROR", "remainingContentQuantity must be a positive number or null.", ctx.requestId);
      if (body.remainingContentUnit !== undefined && body.remainingContentUnit !== null && !["g","kg","ml","l","piece"].includes(String(body.remainingContentUnit))) return fail(res, 400, "VALIDATION_ERROR", "remainingContentUnit must be g, kg, ml, l or piece.", ctx.requestId);
      const hasRemainingQuantity = Object.hasOwn(body, "remainingContentQuantity") && body.remainingContentQuantity !== null && body.remainingContentQuantity !== undefined;
      const hasRemainingUnit = Object.hasOwn(body, "remainingContentUnit") && body.remainingContentUnit !== null && body.remainingContentUnit !== undefined;
      if (hasRemainingQuantity !== hasRemainingUnit) return fail(res, 400, "VALIDATION_ERROR", "remainingContentQuantity and remainingContentUnit must be provided together.", ctx.requestId);
      if ((hasRemainingQuantity || hasRemainingUnit) && (body.openedAt === undefined || body.openedAt === null)) return fail(res, 400, "VALIDATION_ERROR", "openedAt is required when remaining package content is provided.", ctx.requestId);
      if (body.location !== undefined && !validOptionalText(body.location)) return fail(res, 400, "VALIDATION_ERROR", "location must be a string or null.", ctx.requestId);
      if (body.lotCode !== undefined && !validOptionalText(body.lotCode)) return fail(res, 400, "VALIDATION_ERROR", "lotCode must be a string or null.", ctx.requestId);
      if (body.reorderPoint !== undefined && body.reorderPoint !== null && (typeof body.reorderPoint !== "number" || !Number.isFinite(body.reorderPoint) || body.reorderPoint < 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderPoint must be a non-negative number or null.", ctx.requestId);
      if (body.reorderQuantity !== undefined && (typeof body.reorderQuantity !== "number" || !Number.isFinite(body.reorderQuantity) || body.reorderQuantity <= 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderQuantity must be a positive number.", ctx.requestId);
      if (body.reorderQuantity !== undefined && (body.reorderPoint === undefined || body.reorderPoint === null)) return fail(res, 400, "VALIDATION_ERROR", "reorderPoint is required when reorderQuantity is provided.", ctx.requestId);
      const key = String(req.headers["x-idempotency-key"] ?? "").trim();
      if (!requiredIdempotencyKey(key)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const beforeReorder = await readReorderState(client, ctx.familyId, String(body.productId));
        const candidateId = randomUUID();
        // Every stock receipt is a distinct batch. The UI aggregates same-product
        // batches, while Inventory keeps their quantities/expiration dates independent
        // so Shelf-Life can calculate a separate date per receipt and FEFO can consume
        // the earliest-expiring stock first.
        const lotId = randomUUID();
        const declaredExpiry = body.expiresAt ? new Date(String(body.expiresAt)) : null;
        await client.query(
          `INSERT INTO pantry_lots
            (id,family_id,product_id,lot_code,received_at,best_before_at,created_at,updated_at)
           VALUES($1,$2,$3,$4,now(),$5,now(),now())`,
          [lotId, ctx.familyId, String(body.productId), body.lotCode ?? null, declaredExpiry],
        );

        const savedInsert = await client.query(
          `INSERT INTO pantry_items(
             id,family_id,product_id,lot_id,quantity,unit,location,opened_at,remaining_content_quantity,remaining_content_unit,expires_at,expiration_source,lot_code,added_at,created_at,updated_at
           )
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now(),now())
           RETURNING *`
          , [
            candidateId,
            ctx.familyId,
            String(body.productId),
            lotId,
            quantity,
            String(body.unit),
            body.location ?? null,
            body.openedAt == null ? null : new Date(String(body.openedAt)),
            body.remainingContentQuantity ?? null,
            body.remainingContentUnit ?? null,
            declaredExpiry,
            declaredExpiry ? "declared" : null,
            body.lotCode ?? null,
          ],
        );
        if (!savedInsert.rowCount) throw new Error("Inventory item insert returned no row.");
        const id = String(savedInsert.rows[0].id);
        // Every tracked product has an explicit reorder policy. The default is:
        // reorder when completely exhausted, then buy one unit.
        const reorderPoint = body.reorderPoint === undefined || body.reorderPoint === null ? 0 : Number(body.reorderPoint);
        const reorderQuantity = body.reorderQuantity == null ? 1 : Number(body.reorderQuantity);
        await upsertReorderPolicy(client, ctx, String(body.productId), reorderPoint, reorderQuantity, String(body.unit));
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,'add',$5,$6,'added',$7,now(),now())", [randomUUID(), ctx.familyId, id, body.productId, quantity, body.unit, ctx.userId]);
        const afterReorder = await readReorderState(client, ctx.familyId, String(body.productId));
        await emitReorderTransition(client, ctx, beforeReorder, afterReorder);
        const joined = await client.query("SELECT i.*, p.reorder_point, p.reorder_quantity FROM pantry_items i LEFT JOIN reorder_policies p ON p.family_id=i.family_id AND p.product_id=i.product_id AND p.enabled=true WHERE i.id=$1 AND i.family_id=$2", [id, ctx.familyId]);
        await event(client, "inventory.stock.received.v1", id, ctx, {
          itemId: id,
          productId: String(body.productId),
          actorUserId: ctx.userId,
          location: body.location ?? null,
          openedAt: body.openedAt ?? null,
          remainingContentQuantity: body.remainingContentQuantity ?? null,
          remainingContentUnit: body.remainingContentUnit ?? null,
          quantity: String(quantity),
          unit: String(body.unit),
          expiresAt: joined.rows[0].expires_at ? new Date(joined.rows[0].expires_at).toISOString() : null,
          expirationSource: joined.rows[0].expiration_source ?? null,
          occurredAt: new Date().toISOString(),
          storedOn: joined.rows[0].added_at ? new Date(joined.rows[0].added_at).toISOString() : null,
        });
        const output = { data: dto(joined.rows[0] as Record<string, unknown>), version: Number(joined.rows[0].version) };
        await finish(client, key, 201, output);
        await client.query("COMMIT");
        return send(res, 201, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
    if (req.method === "PATCH" && itemMatch && !itemMatch[2]) {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const key = String(req.headers["x-idempotency-key"] ?? "").trim();
      const ifMatch = String(req.headers["if-match"] ?? "").trim();
      if (!requiredIdempotencyKey(key) || !validIfMatch(ifMatch)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key and If-Match are required.", ctx.requestId);
      const allowedFields = ["quantity", "unit", "expiresAt", "location", "lotCode", "openedAt", "remainingContentQuantity", "remainingContentUnit", "reorderPoint", "reorderQuantity"];
      if (Object.keys(body).some((field) => !allowedFields.includes(field))) return fail(res, 400, "VALIDATION_ERROR", "Unknown inventory field.", ctx.requestId);
      if (!Object.keys(body).length) return fail(res, 400, "VALIDATION_ERROR", "At least one field is required.", ctx.requestId);
      if (body.quantity !== undefined && positiveQuantity(body.quantity) === undefined) return fail(res, 400, "VALIDATION_ERROR", "quantity must be positive.", ctx.requestId);
      if (body.reorderPoint !== undefined && body.reorderPoint !== null && (typeof body.reorderPoint !== "number" || !Number.isFinite(body.reorderPoint) || body.reorderPoint < 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderPoint must be a non-negative number or null.", ctx.requestId);
      if (body.reorderQuantity !== undefined && (typeof body.reorderQuantity !== "number" || !Number.isFinite(body.reorderQuantity) || body.reorderQuantity <= 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderQuantity must be a positive number.", ctx.requestId);
      if (body.expiresAt !== undefined && body.expiresAt !== null && !validIsoDate(body.expiresAt)) return fail(res, 400, "VALIDATION_ERROR", "expiresAt is invalid.", ctx.requestId);
      if (body.openedAt !== undefined && body.openedAt !== null && !validIsoDate(body.openedAt)) return fail(res, 400, "VALIDATION_ERROR", "openedAt is invalid.", ctx.requestId);
      if (body.remainingContentQuantity !== undefined && body.remainingContentQuantity !== null && (typeof body.remainingContentQuantity !== "number" || !Number.isFinite(body.remainingContentQuantity) || body.remainingContentQuantity <= 0)) return fail(res, 400, "VALIDATION_ERROR", "remainingContentQuantity must be a positive number or null.", ctx.requestId);
      if (body.remainingContentUnit !== undefined && body.remainingContentUnit !== null && !["g","kg","ml","l","piece"].includes(String(body.remainingContentUnit))) return fail(res, 400, "VALIDATION_ERROR", "remainingContentUnit must be g, kg, ml, l or piece.", ctx.requestId);
      if (Object.hasOwn(body, "remainingContentQuantity") !== Object.hasOwn(body, "remainingContentUnit")) return fail(res, 400, "VALIDATION_ERROR", "remainingContentQuantity and remainingContentUnit must be updated together.", ctx.requestId);
      if (body.location !== undefined && !validOptionalText(body.location)) return fail(res, 400, "VALIDATION_ERROR", "location must be a string or null.", ctx.requestId);
      if (body.lotCode !== undefined && !validOptionalText(body.lotCode)) return fail(res, 400, "VALIDATION_ERROR", "lotCode must be a string or null.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const current = await client.query("SELECT * FROM pantry_items WHERE id=$1 AND family_id=$2 FOR UPDATE", [itemMatch[1], ctx.familyId]);
        if (!current.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId); }
        const row = current.rows[0] as Record<string, unknown>;
        if (String(row.version) !== ifMatch) { await client.query("ROLLBACK"); return fail(res, 412, "PRECONDITION_FAILED", "If-Match does not match current version.", ctx.requestId); }
        if (Object.hasOwn(body, "remainingContentQuantity") || Object.hasOwn(body, "remainingContentUnit") || Object.hasOwn(body, "openedAt")) {
          const finalOpenedAt = Object.hasOwn(body, "openedAt") ? body.openedAt : row.opened_at;
          const finalQuantity = Object.hasOwn(body, "remainingContentQuantity") ? body.remainingContentQuantity : row.remaining_content_quantity;
          const finalUnit = Object.hasOwn(body, "remainingContentUnit") ? body.remainingContentUnit : row.remaining_content_unit;
          const hasFinalQuantity = finalQuantity !== undefined && finalQuantity !== null;
          const hasFinalUnit = finalUnit !== undefined && finalUnit !== null;
          if (hasFinalQuantity !== hasFinalUnit) { await client.query("ROLLBACK"); return fail(res, 400, "VALIDATION_ERROR", "remainingContentQuantity and remainingContentUnit must be present together.", ctx.requestId); }
          if ((hasFinalQuantity || hasFinalUnit) && (finalOpenedAt === undefined || finalOpenedAt === null)) { await client.query("ROLLBACK"); return fail(res, 400, "VALIDATION_ERROR", "openedAt cannot be cleared while residual package content is recorded.", ctx.requestId); }
        }
        if (body.reorderQuantity !== undefined && body.reorderPoint === undefined) {
          const policy = await client.query("SELECT 1 FROM reorder_policies WHERE family_id=$1 AND product_id=$2 AND enabled=true", [ctx.familyId, String(row.product_id)]);
          if (!policy.rowCount) { await client.query("ROLLBACK"); return fail(res, 400, "VALIDATION_ERROR", "reorderPoint is required when setting reorderQuantity.", ctx.requestId); }
        }
        const beforeReorder = await readReorderState(client, ctx.familyId, String(row.product_id));
        const fields: string[] = []; const values: unknown[] = [];
        const add = (sql: string, value: unknown) => { fields.push(sql); values.push(value); };
        if (body.quantity !== undefined) add(`quantity=$${values.length + 1}`, positiveQuantity(body.quantity));
        if (body.unit !== undefined) add(`unit=$${values.length + 1}`, String(body.unit));
        if (body.expiresAt !== undefined) add(`expires_at=$${values.length + 1}`, body.expiresAt === null ? null : new Date(String(body.expiresAt)));
        if (body.location !== undefined) add(`location=$${values.length + 1}`, body.location ?? null);
        if (body.lotCode !== undefined) add(`lot_code=$${values.length + 1}`, body.lotCode ?? null);
        if (body.openedAt !== undefined) add(`opened_at=${values.length + 1}`, body.openedAt === null ? null : new Date(String(body.openedAt)));
        if (body.remainingContentQuantity !== undefined) add(`remaining_content_quantity=${values.length + 1}`, body.remainingContentQuantity);
        if (body.remainingContentUnit !== undefined) add(`remaining_content_unit=${values.length + 1}`, body.remainingContentUnit);
        let updated = row;
        if (fields.length) {
          fields.push("version=version+1", "updated_at=now()"); values.push(itemMatch[1], ctx.familyId);
          const result = await client.query(`UPDATE pantry_items SET ${fields.join(",")} WHERE id=$${values.length - 1} AND family_id=$${values.length} RETURNING *`, values);
          updated = result.rows[0] as Record<string, unknown>;
        }
        if (body.reorderPoint !== undefined) {
          if (body.reorderPoint === null) await client.query("DELETE FROM reorder_policies WHERE family_id=$1 AND product_id=$2", [ctx.familyId, String(row.product_id)]);
          else {
            const existing = await client.query("SELECT reorder_quantity,unit FROM reorder_policies WHERE family_id=$1 AND product_id=$2 AND enabled=true FOR UPDATE", [ctx.familyId, String(row.product_id)]);
            await upsertReorderPolicy(client, ctx, String(row.product_id), Number(body.reorderPoint), body.reorderQuantity == null ? Number(existing.rows[0]?.reorder_quantity ?? 1) : Number(body.reorderQuantity), body.unit == null ? String(existing.rows[0]?.unit ?? row.unit) : String(body.unit));
          }
        } else if (body.reorderQuantity !== undefined) {
          const existing = await client.query("SELECT reorder_point,unit FROM reorder_policies WHERE family_id=$1 AND product_id=$2 AND enabled=true FOR UPDATE", [ctx.familyId, String(row.product_id)]);
          if (!existing.rowCount) { await client.query("ROLLBACK"); return fail(res, 400, "VALIDATION_ERROR", "reorderPoint is required when setting reorderQuantity.", ctx.requestId); }
          await upsertReorderPolicy(client, ctx, String(row.product_id), Number(existing.rows[0].reorder_point), Number(body.reorderQuantity), body.unit == null ? String(existing.rows[0].unit) : String(body.unit));
        }
        const afterReorder = await readReorderState(client, ctx.familyId, String(row.product_id));
        await emitReorderTransition(client, ctx, beforeReorder, afterReorder);
        const joined = await client.query("SELECT i.*, p.reorder_point, p.reorder_quantity FROM pantry_items i LEFT JOIN reorder_policies p ON p.family_id=i.family_id AND p.product_id=i.product_id AND p.enabled=true WHERE i.id=$1 AND i.family_id=$2", [itemMatch[1], ctx.familyId]);
        const output = { data: dto(joined.rows[0] as Record<string, unknown>), version: Number(joined.rows[0].version) };
        await event(client, "inventory.stock.updated.v1", itemMatch[1], ctx, {
          itemId: itemMatch[1],
          productId: String(row.product_id),
          actorUserId: ctx.userId,
          item: output.data,
        });
        await finish(client, key, 200, output);
        await client.query("COMMIT");
        if (body.expiresAt !== undefined || body.openedAt !== undefined) {
        }
        return send(res, 200, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
    if (req.method === "POST" && itemMatch?.[2] === "consume") {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const quantity = positiveQuantity(body.quantity);
      if (quantity === undefined || !isConsumeReason(body.reason)) return fail(res, 400, "VALIDATION_ERROR", "Positive quantity and valid reason are required.", ctx.requestId);
      const key = String(req.headers["x-idempotency-key"] ?? "").trim();
      const ifMatch = String(req.headers["if-match"] ?? "").trim();
      if (!requiredIdempotencyKey(key) || !validIfMatch(ifMatch)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key and If-Match are required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        // The If-Match precondition still protects the item the user interacted with.
        // The actual source row is selected using FEFO: earliest expiration first,
        // with oldest stock as deterministic tie-breaker.
        const requested = await client.query("SELECT * FROM pantry_items WHERE id=$1 AND family_id=$2 FOR UPDATE", [itemMatch[1], ctx.familyId]);
        if (!requested.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId); }
        const requestedRow = requested.rows[0] as Record<string, unknown>;
        if (String(requestedRow.version) !== ifMatch) { await client.query("ROLLBACK"); return fail(res, 412, "PRECONDITION_FAILED", "If-Match does not match current version.", ctx.requestId); }

        const fefo = await client.query(
          "SELECT * FROM pantry_items " +
          "WHERE family_id=$1 AND product_id=$2 AND unit=$3 " +
            "AND location IS NOT DISTINCT FROM $4 " +
          "ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END ASC, " +
            "expires_at ASC NULLS LAST, added_at ASC, created_at ASC, id ASC " +
          "FOR UPDATE",
          [ctx.familyId, String(requestedRow.product_id), String(requestedRow.unit), requestedRow.location ?? null],
        );
        const row = fefo.rows[0] as Record<string, unknown> | undefined;
        if (!row) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "No consumable inventory item found.", ctx.requestId); }
        if (Number(row.quantity) < quantity!) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Insufficient quantity in the oldest expiring stock.", ctx.requestId); }

        const beforeReorder = await readReorderState(client, ctx.familyId, String(row.product_id));
        const updated = await applyOutflow(client, row, quantity!, ctx);
        const movementId = randomUUID();
        const persistedPantryItemId = Number(updated.rows[0]?.quantity ?? 0) > 0 ? String(row.id) : null;
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,'consume',$5,$6,$7,$8,now(),now())", [movementId, ctx.familyId, persistedPantryItemId, row.product_id, quantity, row.unit, body.reason, ctx.userId]);
        const afterReorder = await readReorderState(client, ctx.familyId, String(row.product_id));
        await emitReorderTransition(client, ctx, beforeReorder, afterReorder);
        const consumedItemId = String(row.id);
        const output = { data: dto(updated.rows[0] as Record<string, unknown>), version: Number(updated.rows[0].version) };
        await event(client, "inventory.stock.consumed.v1", consumedItemId, ctx, {
          itemId: consumedItemId,
          productId: String(row.product_id),
          actorUserId: ctx.userId,
          quantity: String(quantity),
          unit: String(row.unit),
          remainingQuantity: Number(updated.rows[0]?.quantity ?? 0),
          removed: Number(updated.rows[0]?.quantity ?? 0) <= 0,
          movementId,
          reason: String(body.reason),
        });
        await finish(client, key, 200, output);
        await client.query("COMMIT");


        return send(res, 200, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
    if (req.method === "POST" && itemMatch?.[2] === "waste") {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const quantity = positiveQuantity(body.quantity);
      if (quantity === undefined || typeof body.reason !== "string" || !body.reason.trim()) return fail(res, 400, "VALIDATION_ERROR", "Positive quantity and reason are required.", ctx.requestId);
      const key = String(req.headers["x-idempotency-key"] ?? "").trim();
      const ifMatch = String(req.headers["if-match"] ?? "").trim();
      if (!requiredIdempotencyKey(key) || !validIfMatch(ifMatch)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key and If-Match are required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const current = await client.query("SELECT * FROM pantry_items WHERE id=$1 AND family_id=$2 FOR UPDATE", [itemMatch[1], ctx.familyId]);
        if (!current.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId); }
        const row = current.rows[0] as Record<string, unknown>;
        if (String(row.version) !== ifMatch) { await client.query("ROLLBACK"); return fail(res, 412, "PRECONDITION_FAILED", "If-Match does not match current version.", ctx.requestId); }
        if (Number(row.quantity) < quantity!) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Insufficient quantity.", ctx.requestId); }
        const beforeReorder = await readReorderState(client, ctx.familyId, String(row.product_id));
        const updated = await applyOutflow(client, row, quantity!, ctx);
        const wasteMovementId = randomUUID();
        const persistedPantryItemId = Number(updated.rows[0]?.quantity ?? 0) > 0 ? itemMatch[1] : null;
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,'waste',$5,$6,$7,$8,now(),now())", [wasteMovementId, ctx.familyId, persistedPantryItemId, row.product_id, quantity, row.unit, body.reason, ctx.userId]);
        const afterReorder = await readReorderState(client, ctx.familyId, String(row.product_id));
        await emitReorderTransition(client, ctx, beforeReorder, afterReorder);
        const output = { data: dto(updated.rows[0] as Record<string, unknown>), version: Number(updated.rows[0].version) };
        await event(client, "inventory.stock.wasted.v1", itemMatch[1], ctx, {
          itemId: itemMatch[1],
          productId: String(row.product_id),
          quantity: String(quantity),
          unit: String(row.unit),
          remainingQuantity: Number(updated.rows[0]?.quantity ?? 0),
          removed: Number(updated.rows[0]?.quantity ?? 0) <= 0,
          movementId: wasteMovementId,
          reason: String(body.reason),
        });
        await finish(client, key, 200, output);
        await client.query("COMMIT");
        return send(res, 200, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }
    if (req.method === "POST" && itemMatch?.[2] === "expiration/confirm") {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      if (body.expiresAt !== null && !validIsoDate(body.expiresAt)) return fail(res, 400, "VALIDATION_ERROR", "expiresAt must be an ISO date or null.", ctx.requestId);
      if (body.source !== undefined && !isExpirationSource(body.source)) return fail(res, 400, "VALIDATION_ERROR", "source is invalid.", ctx.requestId);
      const key = String(req.headers["x-idempotency-key"] ?? "").trim();
      const ifMatch = String(req.headers["if-match"] ?? "").trim();
      if (!requiredIdempotencyKey(key) || !validIfMatch(ifMatch)) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key and If-Match are required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const current = await client.query("SELECT * FROM pantry_items WHERE id=$1 AND family_id=$2 FOR UPDATE", [itemMatch[1], ctx.familyId]);
        if (!current.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId); }
        const row = current.rows[0];
        if (String(row.version) !== ifMatch) { await client.query("ROLLBACK"); return fail(res, 412, "PRECONDITION_FAILED", "If-Match does not match current version.", ctx.requestId); }
        const updated = await client.query("UPDATE pantry_items SET expires_at=$1,expiration_source=$2,version=version+1,updated_at=now() WHERE id=$3 AND family_id=$4 RETURNING *", [body.expiresAt === null ? null : new Date(String(body.expiresAt)), body.source ?? "declared", itemMatch[1], ctx.familyId]);
        await event(client, "inventory.expiration-confirmed.v1", itemMatch[1], ctx, {
          itemId: itemMatch[1],
          productId: String(row.product_id),
          expiresAt: body.expiresAt === null ? null : new Date(String(body.expiresAt)).toISOString(),
          source: String(body.source ?? "declared"),
        });
        const output = { data: dto(updated.rows[0]), version: Number(updated.rows[0].version) };
        await finish(client, key, 200, output);
        await client.query("COMMIT");
        return send(res, 200, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }

    return fail(res, 404, "NOT_FOUND", "Route not found.", ctx.requestId);
  } catch (error) {
    if (!(error instanceof RequestBodyValidationError)) {
      // Prima il 500 era muto: ora la causa (es. SQLSTATE 23514 = CHECK violato) finisce nei log del container.
      console.error(JSON.stringify({
        service,
        event: "request_failed",
        requestId,
        method: req.method,
        path: req.url,
        error: error instanceof Error ? error.message : String(error),
        code: (error as { code?: unknown } | null)?.code,
        constraint: (error as { constraint?: unknown } | null)?.constraint,
      }));
    }
    const message = error instanceof RequestBodyValidationError ? error.message : "Unexpected internal error.";
    const status = error instanceof RequestBodyValidationError ? 400 : 500;
    return fail(res, status, error instanceof RequestBodyValidationError ? "VALIDATION_ERROR" : "INTERNAL_ERROR", message, requestId);
  }
});

server.listen(port, () => console.log(JSON.stringify({ service, port })));

void consumeShelfLifeEvents().catch((error) => {
  console.error(JSON.stringify({
    service,
    event: "shelf_life_event_consumer_failed",
    error: error instanceof Error ? error.message : String(error),
  }));
});