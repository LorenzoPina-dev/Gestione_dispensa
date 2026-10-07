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
const base = (process.env.SHELF_LIFE_SERVICE_BASE_URL ?? "http://service-shelf-life:3404/api/v1").replace(/\/$/, "");
const catalogBase = (process.env.CATALOG_SERVICE_BASE_URL ?? "http://service-catalog:3314/api/v1").replace(/\/$/, "");
const token = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";
const catalogToken = process.env.CATALOG_INTERNAL_TOKEN?.trim() ?? token;
const recoveryIntervalMs = Number(process.env.RECOVERY_INTERVAL_MS ?? 5000);

if (!token) throw new Error("INTERNAL_SERVICE_TOKEN is required.");

await redis.connect();
await redis.xGroupCreate(stream, group, process.env.EVENT_GROUP_START_ID ?? "0-0", { MKSTREAM: true }).catch((error: unknown) => {
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

async function resolveProductCategory(productId: string): Promise<string | null> {
  if (!catalogToken || !productId) return null;
  try {
    const response = await fetch(
      catalogBase + "/catalog/internal/products/" + encodeURIComponent(productId),
      {
        headers: { "x-internal-service-token": catalogToken, accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { category?: unknown } };
    return typeof payload.data?.category === "string" && payload.data.category.trim()
      ? payload.data.category.trim().toLowerCase()
      : null;
  } catch (error) {
    console.warn(JSON.stringify({
      worker: "worker-shelf-life",
      event: "product_category_lookup_failed",
      productId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

async function processQueuedPredictionEvent(event: EventEnvelope): Promise<void> {
  const data = event.payload ?? {};
  if (event.eventType !== "shelf-life.prediction-queued.v1") return;
  const predictionId = typeof data.predictionId === "string" ? data.predictionId : "";
  const itemId = typeof data.itemId === "string" ? data.itemId : "";
  const productId = typeof data.productId === "string" ? data.productId : "";
  const familyId = typeof event.familyId === "string" ? event.familyId : "";
  const userId = typeof data.userId === "string" ? data.userId : "";
  const storage = typeof data.storage === "string" ? data.storage : "PANTRY";
  const opened = typeof data.opened === "boolean" ? data.opened : false;
  if (!predictionId || !itemId || !productId || !familyId || !userId) return;
  await processPrediction({ predictionId, itemId, productId, storage, opened, userId, familyId, status: "queued", ...(typeof data.category === "string" ? { category: data.category } : {}), ...(typeof data.storedOn === "string" ? { storedOn: data.storedOn } : {}) });
}

async function createPredictionFromInventoryEvent(event: EventEnvelope): Promise<void> {
  const data = event.payload ?? {};
  if (event.eventType !== "inventory.stock.received.v1") return;
  const itemId = typeof data.itemId === "string" ? data.itemId : "";
  const productId = typeof data.productId === "string" ? data.productId : "";
  const familyId = typeof event.familyId === "string" ? event.familyId : "";
  const userId = typeof data.actorUserId === "string" ? data.actorUserId : "";
  const storage = typeof data.location === "string" && data.location.trim() ? data.location : "PANTRY";
  const opened = typeof data.openedAt === "string" && data.openedAt.trim().length > 0;
  if (!itemId || !productId || !familyId || !userId) return;
  if (data.expiresAt) return;

  const category = typeof data.category === "string" && data.category.trim()
    ? data.category.trim().toLowerCase()
    : await resolveProductCategory(productId);
  const storedOn = typeof data.storedOn === "string"
    ? data.storedOn
    : (typeof data.occurredAt === "string" ? data.occurredAt : null);

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
      storedAt: storage,
      opened,
      ...(category ? { category } : {}),
      ...(storedOn ? { storedOn } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Prediction queue failed with HTTP " + response.status);
  // The service-shelf-life endpoint durably queues the prediction and publishes
  // shelf-life.prediction-queued.v1. Processing belongs exclusively to that
  // queued event (or the recovery scanner); do not execute it inline here.
}

async function queueRecoveryPrediction(data: RecoveryItem): Promise<RecoveryItem> {
  const response = await fetch(base + "/shelf-life/predictions", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "x-user-id": data.userId,
      "x-family-id": data.familyId,
      "content-type": "application/json",
      "x-idempotency-key": "shelf-life-recovery:" + data.predictionId,
    },
    body: JSON.stringify({
      itemId: data.itemId,
      productId: data.productId,
      familyId: data.familyId,
      storedAt: data.storage,
      opened: data.opened,
      ...(data.category ? { category: data.category } : {}),
      ...(data.storedOn ? { storedOn: data.storedOn } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Prediction requeue failed with HTTP " + response.status);
  const payload = await response.json() as { data?: { predictionId?: unknown } };
  const predictionId = typeof payload.data?.predictionId === "string" ? payload.data.predictionId : "";
  if (!predictionId) throw new Error("Prediction requeue returned no predictionId.");
  return { ...data, predictionId, status: "queued" };
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
  if (!response.ok) {
    if (response.status === 404) {
      const replacement = await queueRecoveryPrediction(data);
      if (replacement.predictionId !== data.predictionId) {
        await processPrediction(replacement);
        return;
      }
    }
    throw new Error("Prediction processing failed with HTTP " + response.status);
  }
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

async function handleDomainMessage(message: { id: string; message: Record<string, string> }): Promise<void> {
  try {
    const raw = message.message.event;
    const event = JSON.parse(String(raw)) as EventEnvelope;
    if (event.eventType === "shelf-life.prediction-queued.v1") {
      await processQueuedPredictionEvent(event);
    } else {
      await createPredictionFromInventoryEvent(event);
    }
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

async function consumeDomainEvents(): Promise<void> {
  const claimed = await redis.xAutoClaim(stream, group, consumer, 30_000, "0-0", { COUNT: 10 });
  for (const message of claimed.messages ?? []) if (message) await handleDomainMessage(message);

  const result = await redis.xReadGroup(group, consumer, [{ key: stream, id: ">" }], { COUNT: 10, BLOCK: 1000 });
  for (const streamResult of result ?? []) {
    for (const message of streamResult.messages) if (message) await handleDomainMessage(message);
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
