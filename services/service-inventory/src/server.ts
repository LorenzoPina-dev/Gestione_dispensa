import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { CONSUME_REASONS, isConsumeReason, isExpirationSource, isPatchFieldSet, positiveQuantity, requiredIdempotencyKey, validIfMatch, validIsoDate, validOptionalText } from "./validation.js";

const port = Number(process.env.PORT ?? 3312);
const service = "service-inventory";
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://inventory:inventory@postgres:5432/inventory_db" });
const familyServiceBaseUrl = (process.env.FAMILY_SERVICE_BASE_URL ?? "http://service-family:3311/api/v1").replace(/\/$/, "");
const catalogServiceBaseUrl = (process.env.CATALOG_SERVICE_BASE_URL ?? "http://service-catalog:3314/api/v1").replace(/\/$/, "");
const shelfLifeServiceBaseUrl = (process.env.SHELF_LIFE_SERVICE_BASE_URL ?? "http://service-shelf-life:3404/api/v1").replace(/\/$/, "");

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


async function queueShelfLifePrediction(
  ctx: Ctx,
  item: { id: string; productId: string; location: string | null; expiresAt: unknown; addedAt?: unknown; openedAt?: unknown },
  authorization?: string,
  force = false,
): Promise<void> {
  if (item.expiresAt && !force) return;

  let category: string | undefined;
  try {
    const response = await fetch(
      catalogServiceBaseUrl + "/catalog/products/" + encodeURIComponent(item.productId),
      {
        headers: {
          accept: "application/json",
          ...(authorization ? { authorization } : {}),
          "x-user-id": ctx.userId,
        },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (response.ok) {
      const payload = await response.json() as { data?: { category?: unknown } };
      if (typeof payload.data?.category === "string" && payload.data.category.trim()) {
        category = payload.data.category.trim();
      }
    }
  } catch {
    // The generic Shelf-Life rule remains available when Catalog is temporarily unavailable.
  }

  try {
    const response = await fetch(shelfLifeServiceBaseUrl + "/shelf-life/predictions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": ctx.userId,
        "x-family-id": ctx.familyId,
        "x-idempotency-key": "inventory-shelf-life:v3:" + ctx.familyId + ":" + item.id,
      },
      body: JSON.stringify({
        itemId: item.id,
        productId: item.productId,
        familyId: ctx.familyId,
        storedAt: item.location ?? "altro",
        opened: Boolean(isoDate(item.openedAt)),
        ...(category ? { category } : {}),
        ...((isoDate(item.openedAt) ?? isoDate(item.addedAt))
          ? { storedOn: isoDate(item.openedAt) ?? isoDate(item.addedAt) }
          : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.warn(JSON.stringify({
        service,
        event: "shelf_life_queue_failed",
        itemId: item.id,
        productId: item.productId,
        status: response.status,
      }));
    }
  } catch (error) {
    console.warn(JSON.stringify({
      service,
      event: "shelf_life_queue_unavailable",
      itemId: item.id,
      productId: item.productId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

function isoDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function queueMissingShelfLifePredictions(
  ctx: Ctx,
  rows: Array<Record<string, unknown>>,
  authorization?: string,
): void {
  for (const row of rows) {
    if (row.expires_at) continue;
    void queueShelfLifePrediction(
      ctx,
      {
        id: String(row.id),
        productId: String(row.product_id),
        location: row.location == null ? null : String(row.location),
        expiresAt: row.expires_at,
        addedAt: row.added_at,
        openedAt: row.opened_at,
      },
      authorization,
    );
  }
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
    ...(row.reorder_point == null ? {} : { reorderPoint: Number(row.reorder_point) }),
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
      const status = url.searchParams.get("status") ?? "current";
      if (status !== "current") return fail(res, 400, "VALIDATION_ERROR", "status must be current.", ctx.requestId);
      const { limit, offset } = pagination(url);
      const result = await pool.query("SELECT * FROM pantry_items WHERE family_id=$1 ORDER BY added_at DESC LIMIT $2 OFFSET $3", [ctx.familyId, limit + 1, offset]);
      const hasNext = result.rows.length > limit;
      const rows = hasNext ? result.rows.slice(0, limit) : result.rows;
      queueMissingShelfLifePredictions(ctx, rows, req.headers.authorization ? String(req.headers.authorization) : undefined);
      return send(res, 200, { items: rows.map(dto), nextCursor: hasNext ? String(offset + limit) : null }, ctx.requestId);
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
      const allowedFields = ["productId", "quantity", "unit", "expiresAt", "location", "lotCode", "openedAt", "reorderPoint"];
      if (Object.keys(body).some((field) => !allowedFields.includes(field))) return fail(res, 400, "VALIDATION_ERROR", "Unknown inventory field.", ctx.requestId);
      if (!body.productId || !body.unit || quantity === undefined) return fail(res, 400, "VALIDATION_ERROR", "productId, unit and positive quantity are required.", ctx.requestId);
      if (body.expiresAt !== undefined && !validIsoDate(body.expiresAt)) return fail(res, 400, "VALIDATION_ERROR", "expiresAt is invalid.", ctx.requestId);
      if (body.openedAt !== undefined && body.openedAt !== null && !validIsoDate(body.openedAt)) return fail(res, 400, "VALIDATION_ERROR", "openedAt is invalid.", ctx.requestId);
      if (body.location !== undefined && !validOptionalText(body.location)) return fail(res, 400, "VALIDATION_ERROR", "location must be a string or null.", ctx.requestId);
      if (body.lotCode !== undefined && !validOptionalText(body.lotCode)) return fail(res, 400, "VALIDATION_ERROR", "lotCode must be a string or null.", ctx.requestId);
      if (body.reorderPoint !== undefined && body.reorderPoint !== null && (typeof body.reorderPoint !== "number" || !Number.isFinite(body.reorderPoint) || body.reorderPoint < 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderPoint must be a non-negative number or null.", ctx.requestId);
      const key = String(req.headers["x-idempotency-key"] ?? "");
      if (!key) return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key is required.", ctx.requestId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const old = await idempotency(client, key, ctx, body);
        if (old?.conflict) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Idempotency key conflict.", ctx.requestId); }
        if (old?.body !== undefined) { await client.query("COMMIT"); return send(res, old.status, old.body, ctx.requestId); }
        const id = randomUUID();
        const result = await client.query("INSERT INTO pantry_items(id,family_id,product_id,quantity,unit,location,opened_at,expires_at,expiration_source,lot_code,reorder_point,added_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now(),now()) RETURNING *", [id, ctx.familyId, String(body.productId), quantity, String(body.unit), body.location ?? null, body.openedAt == null ? null : new Date(String(body.openedAt)), body.expiresAt ? new Date(String(body.expiresAt)) : null, body.expiresAt ? "declared" : null, body.lotCode ?? null, body.reorderPoint == null ? null : Number(body.reorderPoint)]);
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,'add',$5,$6,'added',$7,now(),now())", [randomUUID(), ctx.familyId, id, body.productId, quantity, body.unit, ctx.userId]);
        await event(client, "PantryItemAdjusted", id, ctx, { action: "add", item: dto(result.rows[0]) });
        const output = { data: dto(result.rows[0]), version: Number(result.rows[0].version) };
        await finish(client, key, 201, output);
        await client.query("COMMIT");
        void queueShelfLifePrediction(
          ctx,
          {
            id,
            productId: String(body.productId),
            location: body.location == null ? null : String(body.location),
            expiresAt: result.rows[0].expires_at,
            addedAt: result.rows[0].added_at,
            openedAt: result.rows[0].opened_at,
          },
          req.headers.authorization ? String(req.headers.authorization) : undefined,
        );
        return send(res, 201, output, ctx.requestId);
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }

    if (req.method === "PATCH" && itemMatch && !itemMatch[2]) {
      const auth = await authorizeFamily(ctx, true);
      if (!auth.ok) return fail(res, auth.status, auth.code, auth.message, ctx.requestId);
      const body = await readBody(req);
      const key = String(req.headers["x-idempotency-key"] ?? "").trim();
      const ifMatch = String(req.headers["if-match"] ?? "").trim();
      if (!requiredIdempotencyKey(key) || !validIfMatch(ifMatch)) {
        return fail(res, 400, "VALIDATION_ERROR", "X-Idempotency-Key and If-Match are required.", ctx.requestId);
      }
      const allowedFields = ["quantity", "unit", "expiresAt", "location", "lotCode", "openedAt", "reorderPoint"];
      if (Object.keys(body).some((field) => !allowedFields.includes(field))) return fail(res, 400, "VALIDATION_ERROR", "Unknown inventory field.", ctx.requestId);
      if (!Object.keys(body).length) return fail(res, 400, "VALIDATION_ERROR", "At least one field is required.", ctx.requestId);
      if (body.quantity !== undefined && positiveQuantity(body.quantity) === undefined) return fail(res, 400, "VALIDATION_ERROR", "quantity must be positive.", ctx.requestId);
      if (body.expiresAt !== undefined && body.expiresAt !== null && !validIsoDate(body.expiresAt)) return fail(res, 400, "VALIDATION_ERROR", "expiresAt is invalid.", ctx.requestId);
      if (body.openedAt !== undefined && body.openedAt !== null && !validIsoDate(body.openedAt)) return fail(res, 400, "VALIDATION_ERROR", "openedAt is invalid.", ctx.requestId);
      if (body.location !== undefined && !validOptionalText(body.location)) return fail(res, 400, "VALIDATION_ERROR", "location must be a string or null.", ctx.requestId);
      if (body.lotCode !== undefined && !validOptionalText(body.lotCode)) return fail(res, 400, "VALIDATION_ERROR", "lotCode must be a string or null.", ctx.requestId);
      if (body.reorderPoint !== undefined && body.reorderPoint !== null && (typeof body.reorderPoint !== "number" || !Number.isFinite(body.reorderPoint) || body.reorderPoint < 0)) return fail(res, 400, "VALIDATION_ERROR", "reorderPoint must be a non-negative number or null.", ctx.requestId);
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
        const fields: string[] = [];
        const values: unknown[] = [];
        const add = (sql: string, value: unknown) => { fields.push(sql); values.push(value); };
        if (body.quantity !== undefined) add(`quantity=$${values.length + 1}`, positiveQuantity(body.quantity));
        if (body.unit !== undefined) add(`unit=$${values.length + 1}`, String(body.unit));
        if (body.expiresAt !== undefined) add(`expires_at=$${values.length + 1}`, body.expiresAt === null ? null : new Date(String(body.expiresAt)));
        if (body.location !== undefined) add(`location=$${values.length + 1}`, body.location ?? null);
        if (body.lotCode !== undefined) add(`lot_code=$${values.length + 1}`, body.lotCode ?? null);
        if (body.openedAt !== undefined) add(`opened_at=${values.length + 1}`, body.openedAt === null ? null : new Date(String(body.openedAt)));
        if (body.reorderPoint !== undefined) add(`reorder_point=${values.length + 1}`, body.reorderPoint === null ? null : Number(body.reorderPoint));
        fields.push(`version=version+1`, "updated_at=now()");
        values.push(itemMatch[1], ctx.familyId);
        const updated = await client.query(`UPDATE pantry_items SET ${fields.join(",")} WHERE id=$${values.length - 1} AND family_id=$${values.length} RETURNING *`, values);
        const output = { data: dto(updated.rows[0]), version: Number(updated.rows[0].version) };
        await event(client, "PantryItemAdjusted", itemMatch[1], ctx, { action: "update", item: output.data });
        await finish(client, key, 200, output);
        await client.query("COMMIT");
        if (body.expiresAt !== undefined || body.openedAt !== undefined) {
          void queueShelfLifePrediction(
            ctx,
            {
              id: String(updated.rows[0].id),
              productId: String(updated.rows[0].product_id),
              location: updated.rows[0].location == null ? null : String(updated.rows[0].location),
              expiresAt: updated.rows[0].expires_at,
              addedAt: updated.rows[0].added_at,
              openedAt: updated.rows[0].opened_at,
            },
            req.headers.authorization ? String(req.headers.authorization) : undefined,
            true,
          );
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
        const current = await client.query("SELECT * FROM pantry_items WHERE id=$1 AND family_id=$2 FOR UPDATE", [itemMatch[1], ctx.familyId]);
        if (!current.rowCount) { await client.query("ROLLBACK"); return fail(res, 404, "NOT_FOUND", "Inventory item not found.", ctx.requestId); }
        const row = current.rows[0];
        if (String(row.version) !== ifMatch) { await client.query("ROLLBACK"); return fail(res, 412, "PRECONDITION_FAILED", "If-Match does not match current version.", ctx.requestId); }
        if (Number(row.quantity) < quantity) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Insufficient quantity.", ctx.requestId); }
        const updated = await applyOutflow(client, row, quantity, ctx);
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,'consume',$5,$6,$7,$8,now(),now())", [randomUUID(), ctx.familyId, itemMatch[1], row.product_id, quantity, row.unit, body.reason, ctx.userId]);
        await event(client, "PantryItemAdjusted", itemMatch[1], ctx, { action: "consume", quantity, item: dto(updated.rows[0]) });
        const output = { data: dto(updated.rows[0]), version: Number(updated.rows[0].version) };
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
        const row = current.rows[0];
        if (String(row.version) !== ifMatch) { await client.query("ROLLBACK"); return fail(res, 412, "PRECONDITION_FAILED", "If-Match does not match current version.", ctx.requestId); }
        if (Number(row.quantity) < quantity) { await client.query("ROLLBACK"); return fail(res, 409, "CONFLICT", "Insufficient quantity.", ctx.requestId); }
        const updated = await applyOutflow(client, row, quantity, ctx);
        await client.query("INSERT INTO movements(id,family_id,pantry_item_id,product_id,type,quantity,unit,reason,actor_user_id,occurred_at,created_at) VALUES($1,$2,$3,$4,'waste',$5,$6,$7,$8,now(),now())", [randomUUID(), ctx.familyId, itemMatch[1], row.product_id, quantity, row.unit, body.reason, ctx.userId]);
        await event(client, "PantryItemAdjusted", itemMatch[1], ctx, { action: "waste", quantity, item: dto(updated.rows[0]) });
        const output = { data: dto(updated.rows[0]), version: Number(updated.rows[0].version) };
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
        await event(client, "PantryItemAdjusted", itemMatch[1], ctx, { action: "expiration_confirmed", item: dto(updated.rows[0]) });
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
