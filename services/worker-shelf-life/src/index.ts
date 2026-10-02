import { createClient } from "redis";
import { parseShelfLifeQueueMessage, shelfLifeProcessBody } from "./message.js";

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const queue = "q:shelf-life-prediction";
const base = (process.env.SHELF_LIFE_SERVICE_BASE_URL ?? "http://service-shelf-life:3404/api/v1").replace(/\/$/, "");
const token = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";

await redis.connect();

if (!token) {
  throw new Error("INTERNAL_SERVICE_TOKEN is required.");
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(JSON.stringify({ worker: "worker-shelf-life", queue, owner: "service-shelf-life" }));

while (!stopping) {
  const item = await redis.brPop(queue, 1);
  if (!item) continue;

  try {
    const event = parseShelfLifeQueueMessage(item.element);
    const data = event?.data;
    if (!data?.predictionId || !data.itemId || !data.productId) continue;

    const response = await fetch(
      base + "/internal/shelf-life/predictions/" + encodeURIComponent(data.predictionId) + "/process",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify(shelfLifeProcessBody(data!)),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      console.error(
        JSON.stringify({
          worker: "worker-shelf-life",
          event: "prediction_processing_failed",
          predictionId: data.predictionId,
          status: response.status,
        }),
      );
      continue;
    }
  } catch (error) {
    console.error(JSON.stringify({ worker: "worker-shelf-life", event: "processing_error", error: String(error) }));
  }
}
