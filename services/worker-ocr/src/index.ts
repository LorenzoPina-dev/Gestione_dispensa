import { createClient } from "redis";
import { ocrProcessBody, parseOcrQueueMessage } from "./message.js";

type RecoveryJob = {
  jobId: string;
  familyId?: string | null;
  userId?: string | null;
  objectKey?: string | null;
  type?: string | null;
  status: "queued" | "processing";
};

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const queue = "q:ocr-processing";
const base = (process.env.OCR_SERVICE_BASE_URL ?? "http://service-ocr:3405/api/v1").replace(/\/$/, "");
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
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log(JSON.stringify({ worker: "worker-ocr", queue, owner: "service-ocr" }));

async function processJob(data: {
  jobId: string;
  familyId?: string | null;
  userId?: string | null;
  objectKey?: string | null;
  type?: string | null;
}): Promise<void> {
  const response = await fetch(
    base + "/internal/ocr/jobs/" + encodeURIComponent(data.jobId) + "/process",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(ocrProcessBody({
        jobId: data.jobId,
        familyId: data.familyId ?? undefined,
        userId: data.userId ?? undefined,
        objectKey: data.objectKey ?? undefined,
        type: data.type ?? undefined,
      })),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new Error("OCR processing failed with HTTP " + response.status);
}

async function recoverDurableJobs(): Promise<void> {
  const response = await fetch(base + "/internal/ocr/jobs/recoverable?limit=50", {
    headers: { authorization: "Bearer " + token },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("OCR recovery query failed with HTTP " + response.status);
  const payload = await response.json() as { data?: RecoveryJob[] };
  for (const job of payload.data ?? []) {
    if (!job.jobId) continue;
    try {
      await processJob({
        jobId: job.jobId,
        familyId: job.familyId,
        userId: job.userId,
        objectKey: job.objectKey,
        type: job.type,
      });
    } catch (error) {
      console.error(JSON.stringify({
        worker: "worker-ocr",
        event: "recovery_processing_failed",
        jobId: job.jobId,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

while (!stopping) {
  const item = await redis.brPop(queue, 1);
  if (item) {
    try {
      const event = parseOcrQueueMessage(item.element);
      const data = event?.data;
      if (data?.jobId) {
        await processJob({
          jobId: data.jobId,
          familyId: data.familyId,
          userId: data.userId,
          objectKey: data.objectKey,
          type: data.type,
        });
      }
    } catch (error) {
      console.error(JSON.stringify({
        worker: "worker-ocr",
        event: "processing_error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  if (Date.now() - lastRecoveryAt >= recoveryIntervalMs) {
    lastRecoveryAt = Date.now();
    try {
      await recoverDurableJobs();
    } catch (error) {
      console.error(JSON.stringify({
        worker: "worker-ocr",
        event: "recovery_error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}
