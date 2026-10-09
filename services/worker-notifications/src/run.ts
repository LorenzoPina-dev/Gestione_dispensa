import { createClient } from "redis";
import { createContextAwarePool } from "@gestione-dispensa/runtime-db/postgres-client.js";

type DomainEvent = {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  producer: string;
  aggregateId: string;
  familyId?: string | null;
  correlationId: string;
  causationId?: string | null;
  payload: Record<string, unknown>;
};

const redis = createClient({ url: process.env.REDIS_URL ?? "redis://redis:6379" });
const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL! });
const stream = process.env.EVENT_STREAM ?? "events:domain";
const group = process.env.CONSUMER_GROUP ?? "notifications";
const consumer = process.env.CONSUMER_NAME ?? process.env.HOSTNAME ?? "notifications-1";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

await redis.connect();
try {
  await redis.xGroupCreate(stream, group, "0", { MKSTREAM: true });
} catch (error) {
  if (!String(error).toLowerCase().includes("busygroup")) throw error;
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

function userIdFrom(event: DomainEvent): string | undefined {
  const payload = event.payload ?? {};
  const candidate = payload.userId ?? payload.actorUserId ?? payload.recipientUserId;
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

function notificationFrom(event: DomainEvent): { userId: string; familyId?: string; type: string; title: string; body: string; payload: Record<string, unknown> } | undefined {
  const userId = userIdFrom(event);
  if (!userId) return undefined;

  if (event.eventType === "FamilyMemberAdded" || event.eventType === "FamilyInviteAccepted") {
    return {
      userId,
      ...(event.familyId ? { familyId: event.familyId } : {}),
      type: "family",
      title: "Aggiornamento famiglia",
      body: "La gestione della famiglia è stata aggiornata.",
      payload: { eventId: event.eventId, eventType: event.eventType, aggregateId: event.aggregateId },
    };
  }

  if (event.eventType === "ShelfLifePredictionCompleted" || event.eventType === "ExpirationEstimated") {
    return {
      userId,
      ...(event.familyId ? { familyId: event.familyId } : {}),
      type: "expiration",
      title: "Scadenza stimata",
      body: "È stata calcolata una nuova stima della scadenza.",
      payload: { eventId: event.eventId, eventType: event.eventType, ...event.payload },
    };
  }

  if (event.eventType === "PantryItemAdjusted" && event.payload.action === "expiration_confirmed") {
    return {
      userId,
      ...(event.familyId ? { familyId: event.familyId } : {}),
      type: "expiration",
      title: "Scadenza aggiornata",
      body: "La scadenza dell'articolo è stata aggiornata.",
      payload: { eventId: event.eventId, eventType: event.eventType, ...event.payload },
    };
  }

  return undefined;
}

async function processEvent(event: DomainEvent): Promise<void> {
  const item = notificationFrom(event);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into notifications_domain.processed_events(event_id,event_type,schema_version,producer)
       values($1,$2,$3,$4) on conflict(event_id) do nothing returning event_id`,
      [event.eventId, event.eventType, event.schemaVersion, event.producer],
    );
    if (!inserted.rowCount) {
      await client.query("commit");
      return;
    }

    if (!item) {
      await client.query("commit");
      return;
    }

    const preference = await client.query(
      `select expiration,low_stock,offers,family,system,in_app
       from notifications_domain.preferences where user_id=$1`,
      [item.userId],
    );
    const pref = preference.rows[0];
    const enabled =
      item.type === "expiration" ? (pref?.expiration ?? true) && (pref?.in_app ?? true)
      : item.type === "family" ? (pref?.family ?? true) && (pref?.in_app ?? true)
      : (pref?.system ?? true) && (pref?.in_app ?? true);

    if (enabled) {
      await client.query(
        `insert into notifications_domain.notifications(id,user_id,family_id,type,title,body,payload,created_at,version)
         values(gen_random_uuid(),$1,$2,$3,$4,$5,$6::jsonb,now(),1)`,
        [item.userId, item.familyId ?? null, item.type, item.title, item.body, JSON.stringify(item.payload)],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

console.log(JSON.stringify({ worker: "worker-notifications", stream, group, consumer }));

const retryIdleMs = Math.max(Number(process.env.EVENT_RETRY_IDLE_MS ?? 30000), 1000);

while (!stopping) {
  const claimed = await redis.xAutoClaim(stream, group, consumer, retryIdleMs, "0-0", { COUNT: 20 });
  const fresh = await redis.xReadGroup(
    group,
    consumer,
    [{ key: stream, id: ">" }],
    { COUNT: 20, BLOCK: 1000 },
  );
  const messages = [...(claimed.messages ?? []), ...(fresh?.[0]?.messages ?? [])];

  for (const message of messages) {
      try {
        const raw = message.message.event;
        const event = JSON.parse(raw) as DomainEvent;
        await processEvent(event);
        await redis.xAck(stream, group, message.id);
      } catch (error) {
        console.error(JSON.stringify({
          worker: "worker-notifications",
          event: "event_processing_failed",
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
  }
}
