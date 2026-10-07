import { createClient } from "redis";

type EventEnvelope = {
  eventId: string;
  eventType: string;
  familyId?: string | null;
  payload?: Record<string, unknown>;
};

type RecoveryItem = {
  predictionId: string;
  itemId: string;
  productId: string;
  storage: string;
  opened: boolean;
  category?: string | null;
  storedOn?: string | null;
  userId: string;
  familyId: string;
  status: "queued" | "completed";
};

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const stream = process.env.EVENT_STREAM ?? "events:domain";
const group = process.env.EVENT_CONSUMER_GROUP ?? "shelf-life";
const consumer = process.env.EVENT_CONSUMER_NAME ?? `shelf-life-${process.pid}`;
const queue = "q:shelf-life-prediction";
const base = (process.env.SHELF_LIFE_SERVICE_BASE_URL ?? "http://service-shelf-life:3404/api/v1").replace(/\/$/, "");
const token = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";
const recoveryIntervalMs = Number(process.env.RECOVERY_INTERVAL_MS ?? 5000);

if (!token) throw new Error("INTERNAL_SERVICE_TOKEN is required.");

await redis.connect();
await redis.xGroupCreate(stream, group, "$", { MKSTREAM: true }).catch((error: unknown) => {
  if (!String(error).includes("BUSYGROUP")) throw error;
});

let stopping = false;
let lastRecoveryAt = 0;

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(JSON.stringify({ worker: "worker-shelf-life", stream, group, consumer, owner: "service-shelf-life" }));

async function createPredictionFromInventoryEvent(event: EventEnvelope): Promise<void> {
  const data = event.payload ?? {};
  if (event.eventType !== "PantryItemAdded") return;
  const itemId = typeof data.itemId === "string" ? data.itemId : "";
  const productId = typeof data.productId === "string" ? data.productId : "";
  const familyId = typeof event.familyId === "string" ? event.familyId : "";
  const userId = typeof data.actorUserId === "string" ? data.actorUserId : "";
  if (!itemId || !productId || !familyId || !userId) return;
  if (data.expiresAt) return;

  const response = await fetch(base + "/shelf-life/predictions", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "x-user-id": userId,
      "x-family-id": familyId,
      "content-type": "application/json",
      "x-idempotency-key": "inventory-event:" + event.eventId,
    },
    body: JSON.stringify({
      itemId,
      productId,
      familyId,
      storedAt: "PANTRY",
      opened: false,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Prediction queue failed with HTTP " + response.status);
  const payload = await response.json() as { data?: { predictionId?: string } };
  const predictionId = payload.data?.predictionId;
  if (predictionId) await processPrediction({ predictionId, itemId, productId, storage: "PANTRY", opened: false, userId, familyId, status: "queued" });
}

async function processPrediction(data: RecoveryItem): Promise<void> {
  if (data.status !== "queued") return;
  const response = await fetch(
    base + "/internal/shelf-life/predictions/" + encodeURIComponent(data.predictionId) + "/process",
    {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: data.familyId,
        userId: data.userId,
        itemId: data.itemId,
        productId: data.productId,
        storedAt: data.storage,
        opened: data.opened,
        ...(data.category ? { category: data.category } : {}),
        ...(data.storedOn ? { storedOn: data.storedOn } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error("Prediction processing failed with HTTP " + response.status);
}

async function recoverDurableWork(): Promise<void> {
  const response = await fetch(base + "/internal/shelf-life/predictions/recoverable?limit=50", {
    headers: { authorization: "Bearer " + token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Recovery query failed with HTTP " + response.status);
  const payload = await response.json() as { data?: RecoveryItem[] };
  for (const item of payload.data ?? []) {
    if (item.status !== "queued" || !item.predictionId || !item.itemId || !item.productId || !item.userId || !item.familyId) continue;
    try {
      await processPrediction(item);
    } catch (error) {
      console.error(JSON.stringify({
        worker: "worker-shelf-life",
        event: "recovery_processing_failed",
        predictionId: item.predictionId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

async function consumeDomainEvents(): Promise<void> {
  const result = await redis.xReadGroup(group, consumer, [{ key: stream, id: ">" }], { COUNT: 10, BLOCK: 1000 });
  for (const streamResult of result ?? []) {
    for (const message of streamResult.messages) {
      try {
        const raw = message.message.event;
        const event = JSON.parse(String(raw)) as EventEnvelope;
        await createPredictionFromInventoryEvent(event);
        await redis.xAck(stream, group, message.id);
      } catch (error) {
        console.error(JSON.stringify({
          worker: "worker-shelf-life",
          event: "domain_event_processing_failed",
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }
}

while (!stopping) {
  try { await consumeDomainEvents(); }
  catch (error) {
    console.error(JSON.stringify({ worker: "worker-shelf-life", event: "stream_read_failed", error: error instanceof Error ? error.message : String(error) }));
  }

  if (Date.now() - lastRecoveryAt >= recoveryIntervalMs) {
    lastRecoveryAt = Date.now();
    try { await recoverDurableWork(); }
    catch (error) {
      console.error(JSON.stringify({ worker: "worker-shelf-life", event: "recovery_error", error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
