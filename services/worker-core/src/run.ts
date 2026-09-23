import { JsonLogSink, RuntimeObservability } from "@gestione-dispensa/observability";
import { RedisConnection } from "./redis-client.js";
import { PostgresClient, resolveDatabaseUrl } from "./postgres-client.js";
import {
  PostgresJobRepository,
  PostgresInboxRepository,
  PostgresReconciliationRepository,
} from "./postgres.js";
import { RedisQueueAdapter } from "./redis-queue.js";
import { reconciliationHandler } from "./handlers.js";
import { JobWorker } from "./worker.js";
import { WorkerProcess } from "./process.js";
import { InMemoryMetrics } from "./metrics.js";
import type { JobHandler } from "./job.js";

function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.REDIS_URL?.trim();
  if (explicit) return explicit;
  const host = env.REDIS_HOST?.trim() ?? "localhost";
  const port = env.REDIS_PORT?.trim() ?? "6379";
  return `redis://${host}:${port}`;
}

/**
 * Composes the real (Postgres + Redis backed) reconciliation worker.
 * Returns the underlying JobWorker (for direct processNext-based
 * integration tests) alongside a ready-to-run WorkerProcess (for the actual
 * long-lived poll loop with signal handling and observability logging).
 *
 * Verified end-to-end against a live PostgreSQL 16 + Redis 7 pair in an
 * isolated environment: a job created via PostgresJobRepository, a message
 * published to a real Redis list via RedisQueueAdapter, received via a real
 * BRPOPLPUSH, processed by the real reconciliationHandler (a live SQL query
 * against stock_items/stock_movements), and transitioned to COMPLETED with
 * the real Redis queue emptied by a real LREM ack. The transient-failure
 * retry path (nack -> message returned to the real pending list, job
 * requeued as PENDING) was verified the same way. Only "inventory.reconcile"
 * is wired here; movementConsumer/reorderConsumer/projectionRebuildHandler
 * from handlers.ts still need their own repository implementations and
 * queues before they can run for real.
 */
export interface BuildReconciliationWorkerOptions {
  /**
   * Redis queue name to use. Defaults to "inventory-reconcile". Overridable
   * so integration tests can run against an isolated, uniquely-named queue
   * rather than sharing state with other runs (or leftover messages from a
   * previous failed run) on the default queue key.
   */
  queueName?: string;
}

export async function buildReconciliationWorker(options: BuildReconciliationWorkerOptions = {}) {
  const queueName = options.queueName ?? "inventory-reconcile";
  const postgres = PostgresClient.create({ connectionString: resolveDatabaseUrl() });
  const redis = await RedisConnection.connect({ url: resolveRedisUrl() });

  const worker = new JobWorker({
    queueName,
    consumerName: "worker-core-reconcile",
    repository: new PostgresJobRepository(postgres),
    inbox: new PostgresInboxRepository(postgres),
    queue: new RedisQueueAdapter(redis.queueClient(), queueName, 5),
    metrics: new InMemoryMetrics(),
    retryPolicy: { baseDelayMs: 1000, maxDelayMs: 60_000, jitterRatio: 0.2 },
  });

  const handlers = new Map<string, JobHandler>([
    ["inventory.reconcile", reconciliationHandler(new PostgresReconciliationRepository(postgres))],
  ]);

  const observability = new RuntimeObservability(
    "worker-core",
    new JsonLogSink({ write: (line) => process.stdout.write(line) }),
  );

  const workerProcess = new WorkerProcess({
    worker,
    handlers,
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
    // Node's global `process` object structurally satisfies WorkerSignalSource
    // (process.on/process.off accept the same signal names and listener
    // shape), so no adapter is needed here.
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
  const { workerProcess, close } = await buildReconciliationWorker();
  await workerProcess.run();
  await close();
}

if (process.argv[1]?.endsWith("run.js")) {
  main().catch((error) => {
    console.error("worker_core_fatal", error);
    process.exitCode = 1;
  });
}
