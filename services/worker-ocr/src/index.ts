import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const queue = "q:ocr-processing";
const base = (process.env.OCR_SERVICE_BASE_URL ?? "http://service-ocr:3405/api/v1").replace(/\/$/, "");
const token = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";

if (!token) throw new Error("INTERNAL_SERVICE_TOKEN is required.");

await redis.connect();

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log(JSON.stringify({ worker: "worker-ocr", queue, owner: "service-ocr" }));

while (!stopping) {
  const item = await redis.brPop(queue, 1);
  if (!item) continue;

  try {
    const event = JSON.parse(item.element) as {
      data?: { jobId?: string; familyId?: string; userId?: string; objectKey?: string; type?: string };
    };
    const jobId = event.data?.jobId;
    if (!jobId) continue;

    const response = await fetch(
      base + "/internal/ocr/jobs/" + encodeURIComponent(jobId) + "/process",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          familyId: event.data?.familyId ?? null,
          userId: event.data?.userId ?? null,
          objectKey: event.data?.objectKey ?? null,
          type: event.data?.type ?? "receipt",
        }),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!response.ok) {
      console.error(JSON.stringify({
        worker: "worker-ocr",
        event: "ocr_processing_failed",
        jobId,
        status: response.status,
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      worker: "worker-ocr",
      event: "processing_error",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
