import { createClient } from "redis";
import { Pool } from "pg";
import crypto from "node:crypto";

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const pool = new Pool({ connectionString: process.env.OCR_DATABASE_URL ?? process.env.DATABASE_URL });

await redis.connect();

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(JSON.stringify({ worker: "worker-ocr", queue: "q:ocr-processing" }));

while (!stopping) {
  const item = await redis.brPop("q:ocr-processing", 1);
  if (!item) continue;

  try {
    const event = JSON.parse(item.element) as {
      data?: { jobId?: string; familyId?: string; userId?: string; objectKey?: string; type?: string };
    };
    const jobId = event.data?.jobId;
    if (!jobId) continue;

    const client = await pool.connect();
    try {
      await client.query("begin");

      const job = await client.query(
        "select id,type,status,version from ocr_domain.ocr_jobs where id=$1 for update",
        [jobId],
      );
      if (!job.rowCount) {
        await client.query("rollback");
        continue;
      }

      if (job.rows[0].status === "completed" || job.rows[0].status === "cancelled") {
        await client.query("commit");
        continue;
      }

      await client.query(
        "update ocr_domain.ocr_jobs set status='needs_review',progress=100,updated_at=now(),version=version+1 where id=$1",
        [jobId],
      );

      const draft = await client.query(
        `insert into ocr_domain.ocr_drafts(id,job_id,confidence,status,raw_result)
         values($1,$2,0,'draft',$3::jsonb)
         on conflict(job_id) do nothing
         returning id`,
        [
          crypto.randomUUID(),
          jobId,
          JSON.stringify({
            status: "needs_review",
            source: "worker-ocr",
            objectKey: event.data?.objectKey ?? null,
            items: [],
          }),
        ],
      );

      if (draft.rowCount) {
        await client.query(
          `insert into ocr_domain.ocr_draft_items(id,draft_id,name,quantity,unit,confidence)
           values($1,$2,'Da verificare',1,'piece',0)`,
          [crypto.randomUUID(), draft.rows[0].id],
        );
      }

      await client.query(
        `insert into ocr_domain.outbox_events
          (event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at)
         values($1,'OcrDraftReady',1,$2,$3,$4,now(),$5::jsonb,now())`,
        [
          crypto.randomUUID(),
          jobId,
          event.data?.familyId ?? null,
          crypto.randomUUID(),
          JSON.stringify({ jobId, draftId: draft.rows[0]?.id ?? null }),
        ],
      );

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      console.error("ocr_worker_error", error);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("ocr_worker_parse_error", error);
  }
}
