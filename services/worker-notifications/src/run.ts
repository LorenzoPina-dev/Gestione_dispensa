import { JsonLogSink, RuntimeObservability } from "@gestione-dispensa/observability";
import {
  InMemoryMetrics,
  JobWorker,
  PostgresClient,
  PostgresInboxRepository,
  PostgresJobRepository,
  QUEUE_NAMES,
  RedisConnection,
  RedisQueueAdapter,
  WorkerProcess,
  resolveDatabaseUrl,
  type JobHandler,
} from "@gestione-dispensa/worker-core";
import { familyPushHandler, LoggingPushProvider } from "./family-push.js";
import { PostgresFamilyPushRepository } from "./postgres.js";

function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.REDIS_URL?.trim();
  if (explicit) return explicit;
  const host = env.REDIS_HOST?.trim() ?? "localhost";
  const port = env.REDIS_PORT?.trim() ?? "6379";
  return `redis://${host}:${port}`;
}

/**
 * Composes the real notifications-queue consumer: fan-out to a family's opted-in members
 * (PostgresFamilyPushRepository, see migration 0017_pantry-optimization-and-new-features.sql's
 * user_notification_settings) and delivery via LoggingPushProvider until a real push
 * gateway (APNs/FCM/Web Push) is wired in -- see family-push.ts's doc comment. Mirrors
 * services/worker-core/src/run.ts's buildReconciliationWorker composition shape exactly, so the
 * same JobWorker/WorkerProcess/observability stack backs every queue in this system.
 */
export async function buildNotificationsWorker(options: { queueName?: string } = {}) {
  const queueName = options.queueName ?? QUEUE_NAMES.NOTIFICATIONS;
  const postgres = PostgresClient.create({ connectionString: resolveDatabaseUrl() });
  const redis = await RedisConnection.connect({ url: resolveRedisUrl() });

  const worker = new JobWorker({
    queueName,
    consumerName: "worker-notifications-push",
    repository: new PostgresJobRepository(postgres),
    inbox: new PostgresInboxRepository(postgres),
    queue: new RedisQueueAdapter(redis.queueClient(), queueName, 5),
    metrics: new InMemoryMetrics(),
    retryPolicy: { baseDelayMs: 1000, maxDelayMs: 60_000, jitterRatio: 0.2 },
  });

  const observability = new RuntimeObservability(
    "worker-notifications",
    new JsonLogSink({ write: (line) => process.stdout.write(line) }),
  );
  const pushLog = observability.logger({ requestId: "system", traceId: "push" });
  const provider = new LoggingPushProvider((line, fields) => pushLog.info(line, fields));
  const repository = new PostgresFamilyPushRepository(postgres);

  const handlers = new Map<string, JobHandler>([
    ["notifications.push", familyPushHandler(repository, provider) as unknown as JobHandler],
  ]);

  const workerProcess = new WorkerProcess({
    worker,
    handlers,
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
    signals: process,
    observability,
  });

  return {
    worker,
    workerProcess,
    postgres,
    redis,
    async close() {
      await redis.close();
      await postgres.close();
    },
  };
}

export async function main(): Promise<void> {
  const { workerProcess, close } = await buildNotificationsWorker();
  await workerProcess.run();
  await close();
}

if (process.argv[1]?.endsWith("run.js")) {
  main().catch((error) => {
    console.error("worker_notifications_fatal", error);
    process.exitCode = 1;
  });
}
