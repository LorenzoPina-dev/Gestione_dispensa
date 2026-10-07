import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { createClient } from "redis";

const databaseUrl = process.env.DATABASE_URL;
const outboxTable = process.env.OUTBOX_TABLE ?? "outbox_events";
const producer = process.env.PRODUCER ?? "unknown";
const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const stream = process.env.EVENT_STREAM ?? "events:domain";
const pollMs = Number(process.env.POLL_MS ?? 500);
const batchSize = Math.min(Math.max(Number(process.env.BATCH_SIZE ?? 50), 1), 200);

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?$/.test(outboxTable)) {
  throw new Error("OUTBOX_TABLE must be a simple table or schema.table identifier.");
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

console.log(JSON.stringify({ worker: "worker-outbox", producer, outboxTable, stream }));

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
    let published = 0;
    for (const row of rows.rows) {
      const envelope = {
        eventId: String(row.event_id),
        eventType: String(row.event_type),
        schemaVersion: Number(row.schema_version),
        occurredAt: new Date(row.occurred_at).toISOString(),
        producer,
        aggregateId: String(row.aggregate_id),
        familyId: row.family_id == null ? null : String(row.family_id),
        correlationId: String(row.correlation_id),
        causationId: null,
        payload: row.payload ?? {},
      };
      await redis.xAdd(stream, "*", { event: JSON.stringify(envelope) });
      await client.query(
        `update ${outboxTable} set published_at=now(), attempts=attempts+1, last_error=null where event_id=$1`,
        [row.event_id],
      );
      published += 1;
    }
    await client.query("commit");
    return published;
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

while (!stopping) {
  const published = await publishBatch();
  if (published === 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
}
