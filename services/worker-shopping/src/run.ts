import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { createContextAwarePool, type PoolClient } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { lowStockSuggestionPayload, parseReorderEvent, type ReorderEvent } from "./reorder.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const stream = process.env.EVENT_STREAM ?? "events:domain";
const group = process.env.CONSUMER_GROUP ?? "shopping-reorder";
const consumer = process.env.CONSUMER_NAME ?? process.env.HOSTNAME ?? "shopping-reorder-1";

if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = createContextAwarePool({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
await redis.connect();
try {
  await redis.xGroupCreate(stream, group, "0", { MKSTREAM: true });
} catch (error) {
  if (!String(error).toLowerCase().includes("busygroup")) throw error;
}

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function emitSuggestionEvent(client: import("pg").PoolClient, event: ReorderEvent, type: "ShoppingItemSuggested" | "ShoppingSuggestionResolved", suggestionId: string, payload: Record<string, unknown>): Promise<void> {
  await client.query(
    "insert into shopping_domain.outbox_events (event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,causation_id,occurred_at,payload,created_at) values(gen_random_uuid(),$1,1,$2,$3,$4,$5,now(),$6::jsonb,now())",
    [type, suggestionId, event.familyId ?? null, event.correlationId, event.eventId, JSON.stringify(payload)],
  );
}

async function processEvent(event: ReorderEvent): Promise<void> {
  if (!event.familyId) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const processed = await client.query(
      "insert into shopping_domain.processed_events(event_id,event_type) values($1,$2) on conflict(event_id) do nothing returning event_id",
      [event.eventId, event.eventType],
    );
    if (!processed.rowCount) { await client.query("commit"); return; }

    const productId = typeof event.payload.productId === "string" && event.payload.productId.trim() ? event.payload.productId : event.aggregateId;

    if (event.eventType === "PantryLowStock") {
      const input = lowStockSuggestionPayload(event);
      if (!input) { await client.query("commit"); return; }
      const current = await client.query("select * from shopping_domain.reorder_suggestions where family_id=$1 and product_id=$2 for update", [event.familyId, input.productId]);
      let suggestionId: string;
      let changed = true;
      if (!current.rowCount) {
        suggestionId = randomUUID();
        await client.query("insert into shopping_domain.reorder_suggestions (id,family_id,product_id,quantity,unit,reorder_point,status,source_event_id) values($1,$2,$3,$4,$5,$6,'active',$7)", [suggestionId,event.familyId,input.productId,input.quantity,input.unit,input.reorderPoint,event.eventId]);
      } else {
        suggestionId = String(current.rows[0].id);
        changed = String(current.rows[0].status) !== "active" || Number(current.rows[0].quantity) !== input.quantity || String(current.rows[0].unit) !== input.unit || Number(current.rows[0].reorder_point) !== input.reorderPoint;
        await client.query("update shopping_domain.reorder_suggestions set quantity=$3,unit=$4,reorder_point=$5,status='active',source_event_id=$6,updated_at=now(),version=version+1 where id=$1 and family_id=$2", [suggestionId,event.familyId,input.quantity,input.unit,input.reorderPoint,event.eventId]);
      }
      if (changed) await emitSuggestionEvent(client,event,"ShoppingItemSuggested",suggestionId,{ suggestionId, productId: input.productId, quantity: input.quantity, unit: input.unit, reorderPoint: input.reorderPoint });
    } else if (event.eventType === "PantryStockReplenished" || event.eventType === "PantryReorderPolicyDisabled") {
      const current = await client.query("select * from shopping_domain.reorder_suggestions where family_id=$1 and product_id=$2 and status='active' for update", [event.familyId, productId]);
      if (current.rowCount) {
        const suggestionId = String(current.rows[0].id);
        await client.query("update shopping_domain.reorder_suggestions set status='resolved',source_event_id=$3,updated_at=now(),version=version+1 where id=$1 and family_id=$2", [suggestionId,event.familyId,event.eventId]);
        await emitSuggestionEvent(client,event,"ShoppingSuggestionResolved",suggestionId,{ suggestionId, productId });
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

console.log(JSON.stringify({ worker: "worker-shopping", stream, group, consumer }));

const retryIdleMs = Math.max(Number(process.env.EVENT_RETRY_IDLE_MS ?? 30000), 1000);
let claimCursor = "0-0";

while (!stopping) {
  const claimed = await redis.xAutoClaim(stream, group, consumer, retryIdleMs, claimCursor, { COUNT: 20 });
  claimCursor = claimed.nextId ?? "0-0";
  const fresh = await redis.xReadGroup(group, consumer, [{ key: stream, id: ">" }], { COUNT: 20, BLOCK: 1000 });
  const messages = [...(claimed.messages ?? []), ...(fresh?.[0]?.messages ?? [])];
  for (const message of messages) {
    try {
      const raw = message.message.event;
      const event = parseReorderEvent(JSON.parse(raw));
      if (event) await processEvent(event);
      await redis.xAck(stream, group, message.id);
    } catch (error) {
      console.error(JSON.stringify({ worker: "worker-shopping", event: "reorder_processing_failed", messageId: message.id, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
