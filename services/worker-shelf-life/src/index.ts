import { createClient } from "redis";
import { parseShelfLifeQueueMessage, shelfLifeProcessBody } from "./message.js";

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
const queue = "q:shelf-life-prediction";
const base = (process.env.SHELF_LIFE_SERVICE_BASE_URL ?? "http://service-shelf-life:3404/api/v1").replace(/\/$/, "");
const token = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";
const recoveryIntervalMs = Number(process.env.RECOVERY_INTERVAL_MS ?? 5000);

if (!token) throw new Error("INTERNAL_SERVICE_TOKEN is required.");

await redis.connect();

let stopping = false;
let lastRecoveryAt = 0;

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(JSON.stringify({ worker: "worker-shelf-life", queue, owner: "service-shelf-life" }));

async function applyPrediction(data: RecoveryItem): Promise<void> {
  const apply = await fetch(
    base + "/shelf-life/predictions/" + encodeURIComponent(data.predictionId) + "/apply",
    {
      method: "POST",
      headers: {
        "authorization": "Bearer " + token,
        "x-user-id": data.userId,
        "x-family-id": data.familyId,
        "content-type": "application/json",
        "x-idempotency-key": "shelf-life-apply:" + data.predictionId,
      },
      body: "{}",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!apply.ok) {
    throw new Error("Prediction apply failed with HTTP " + apply.status);
  }
}

async function processPrediction(data: RecoveryItem): Promise<void> {
  if (data.status === "queued") {
    const response = await fetch(
      base + "/internal/shelf-life/predictions/" + encodeURIComponent(data.predictionId) + "/process",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
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
      throw new Error("Prediction processing failed with HTTP " + response.status);
    }
  }
  await applyPrediction(data);
}

async function recoverDurableWork(): Promise<void> {
  const response = await fetch(base + "/internal/shelf-life/predictions/recoverable?limit=50", {
    headers: { authorization: "Bearer " + token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Recovery query failed with HTTP " + response.status);
  const payload = await response.json() as { data?: RecoveryItem[] };
  for (const item of payload.data ?? []) {
    if (!item.predictionId || !item.itemId || !item.productId || !item.userId || !item.familyId) continue;
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

while (!stopping) {
  const item = await redis.brPop(queue, 1);
  if (item) {
    try {
      const event = parseShelfLifeQueueMessage(item.element);
      const data = event?.data;
      if (data?.predictionId && data.itemId && data.productId && data.userId && data.familyId) {
        await processPrediction({
          predictionId: data.predictionId,
          itemId: data.itemId,
          productId: data.productId,
          storage: String(data.storage ?? "OTHER"),
          opened: data.opened === true,
          category: data.category ?? null,
          storedOn: data.storedOn ?? null,
          userId: data.userId,
          familyId: data.familyId,
          status: "queued",
        });
      }
    } catch (error) {
      console.error(JSON.stringify({
        worker: "worker-shelf-life",
        event: "processing_error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  if (Date.now() - lastRecoveryAt >= recoveryIntervalMs) {
    lastRecoveryAt = Date.now();
    try {
      await recoverDurableWork();
    } catch (error) {
      console.error(JSON.stringify({
        worker: "worker-shelf-life",
        event: "recovery_error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}