import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { createClient } from "redis";

const databaseUrl = process.env.DATABASE_URL;
const outboxTable = process.env.OUTBOX_TABLE ?? "outbox_events";
const producer = process.env.PRODUCER ?? "unknown";
const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const stream = process.env.EVENT_STREAM ?? "events:domain";
const pollMs = Number(process.env.POLL_MS ?? 500);
const batchSize = Math.min(Math.max(Number(process.env.BATCH_SIZE ?? 50), 1), 200);
const retentionDays = Math.max(Number(process.env.OUTBOX_RETENTION_DAYS ?? 90), 0);
const replaySince = process.env.REPLAY_SINCE;

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!/^[a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)?$/.test(outboxTable)) {
  throw new Error("OUTBOX_TABLE must be a simple table or schema.table identifier.");
}
if (replaySince && Number.isNaN(Date.parse(replaySince))) {
  throw new Error("REPLAY_SINCE must be a valid ISO-8601 timestamp.");
}

const pool = createContextAwarePool({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
await redis.connect();

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log(JSON.stringify({ worker: "worker-outbox", producer, outboxTable, stream, retentionDays }));

function eventEnvelope(row: Record<string, unknown>) {
  return {
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    schemaVersion: Number(row.schema_version),
    occurredAt: (row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at))).toISOString(),
    producer,
    aggregateId: String(row.aggregate_id),
    familyId: row.family_id == null ? null : String(row.family_id),
    correlationId: String(row.correlation_id),
    causationId: null,
    payload: row.payload ?? {},
  };
}

async function publishBatch(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const rows = await client.query(
      `select event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload
       from ${outboxTable}
       where published_at is null
       order by created_at asc
       limit $1
       for update skip locked`,
      [batchSize],
    );
    for (const row of rows.rows) {
      await redis.xAdd(stream, "*", { event: JSON.stringify(eventEnvelope(row)) });
      await client.query(
        `update ${outboxTable} set published_at=now(), attempts=attempts+1, last_error=null where event_id=$1`,
        [row.event_id],
      );
    }
    await client.query("commit");
    return rows.rowCount ?? 0;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error(JSON.stringify({
      worker: "worker-outbox",
      event: "publish_failed",
      producer,
      error: error instanceof Error ? error.message : String(error),
    }));
    return 0;
  } finally {
    client.release();
  }
}

/** Replays a bounded time window without changing outbox publication state. */
async function replayPublishedEvents(since: Date): Promise<number> {
  let cursorAt: Date | string = since;
  let cursorId: string | null = null;
  let replayed = 0;

  while (true) {
    const rows = await pool.query(
      `select event_id,event_type,schema_version,aggregate_id,family_id,correlation_id,occurred_at,payload,created_at::text as created_at
       from ${outboxTable}
       where created_at >= $1 and (created_at > $2 or (created_at = $2 and ($3::uuid is null or event_id > $3::uuid)))
       order by created_at,event_id
       limit $4`,
      [since, cursorAt, cursorId, batchSize],
    );
    if (!rows.rowCount) break;

    for (const row of rows.rows) {
      await redis.xAdd(stream, "*", { event: JSON.stringify(eventEnvelope(row)) });
      cursorAt = String(row.created_at);
      cursorId = String(row.event_id);
      replayed += 1;
    }
  }

  return replayed;
}

async function reportRetentionCandidates(): Promise<number> {
  if (retentionDays === 0) return 0;
  const result = await pool.query(
    `select count(*)::int as count from ${outboxTable}
     where published_at is not null and created_at < now() - ($1 * interval '1 day')`,
    [retentionDays],
  );
  return Number(result.rows[0]?.count ?? 0);
}

if (replaySince) {
  try {
    const replayed = await replayPublishedEvents(new Date(replaySince));
    console.log(JSON.stringify({ worker: "worker-outbox", event: "replay_completed", producer, since: replaySince, replayed }));
  } finally {
    await shutdown();
  }
} else {
  let nextRetentionSweep = 0;
  while (!stopping) {
    const published = await publishBatch();
    const now = Date.now();
    if (now >= nextRetentionSweep) {
      try {
        const candidates = await reportRetentionCandidates();
        console.log(JSON.stringify({ worker: "worker-outbox", event: "retention_review", producer, retentionDays, candidates, action: "retained_pending_ack_safe_archive_policy" }));
      } catch (error) {
        console.error(JSON.stringify({
          worker: "worker-outbox",
          event: "retention_review_failed",
          producer,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      nextRetentionSweep = now + 24 * 60 * 60 * 1000;
    }
    if (published === 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
