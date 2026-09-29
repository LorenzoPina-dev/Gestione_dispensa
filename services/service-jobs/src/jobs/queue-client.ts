import {
  JOB_CAPABILITIES,
  JobProducer,
  PostgresClient,
  PostgresJobRepository,
  QUEUE_NAMES,
  RedisConnection,
  RedisQueueAdapter,
  resolveDatabaseUrl,
} from "@gestione-dispensa/worker-core";

/**
 * Composes the four producer-side entry points onto the async flows (receipt OCR, Open Food
 * Facts background sync, push notifications, audit events) using the SAME transactional
 * job/queue stack `services/worker-core` already ships (see queues.ts's doc comment for why this
 * is deliberately not a second, BullMQ-based queueing system). the former core service only ever PRODUCES onto
 * these queues; the corresponding workers (services/worker-integrations,
 * services/worker-notifications, services/worker-core) consume them in separate processes.
 *
 * Entirely optional: with REDIS_URL unset (local dev without Redis, or any existing test that
 * builds the HTTP app directly with hand-crafted options), `createOptionalJobProducers` returns
 * undefined and every caller (NotificationService, the receipts module, ...) degrades to its
 * pre-0017 synchronous-only behaviour instead of failing to start -- the same optionality
 * pattern already used for OFF_LOOKUP_BASE_URL and EXPIRY_SCAN_ENABLED in server.ts.
 */
export interface JobProducers {
  readonly receiptOcr: JobProducer;
  readonly offSync: JobProducer;
  readonly notificationsPush: JobProducer;
  readonly audit: JobProducer;
  /** See services/worker-core/src/queues.ts QUEUE_NAMES.PRIVACY_ERASURE for status/caveats. */
  readonly privacyErasure: JobProducer;
  /** See services/worker-core/src/queues.ts QUEUE_NAMES.PRIVACY_EXPORT for status/caveats. */
  readonly privacyExport: JobProducer;
  close(): Promise<void>;
}

function resolveRedisUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.REDIS_URL?.trim();
  if (explicit) return explicit;
  if (!env.REDIS_HOST?.trim()) return undefined;
  const port = env.REDIS_PORT?.trim() ?? "6379";
  return `redis://${env.REDIS_HOST.trim()}:${port}`;
}

export async function createOptionalJobProducers(
  env: NodeJS.ProcessEnv = process.env,
): Promise<JobProducers | undefined> {
  const redisUrl = resolveRedisUrl(env);
  if (!redisUrl) return undefined;

  const redis = await RedisConnection.connect({ url: redisUrl, connectTimeoutMs: 5_000 });
  // A small, separate connection pool dedicated to job enqueue (distinct from the former core service's own
  // PostgresClient in db/postgres-client.ts): keeps the write path for the `jobs` table
  // completely decoupled from the request-handling pool's sizing/lifecycle, at the cost of one
  // extra small pool. Acceptable trade-off given how infrequently this path is exercised
  // relative to ordinary CRUD traffic.
  const postgres = PostgresClient.create({ connectionString: resolveDatabaseUrl(env), max: 3 });
  const repository = new PostgresJobRepository(postgres);
  const queueClient = redis.queueClient();

  const producer = (queueName: string, capability: string): JobProducer =>
    new JobProducer(repository, new RedisQueueAdapter(queueClient, queueName, 5), queueName, capability);

  return {
    receiptOcr: producer(QUEUE_NAMES.RECEIPT_OCR, JOB_CAPABILITIES.RECEIPT_OCR),
    offSync: producer(QUEUE_NAMES.OFF_SYNC, JOB_CAPABILITIES.OFF_SYNC),
    notificationsPush: producer(QUEUE_NAMES.NOTIFICATIONS, JOB_CAPABILITIES.NOTIFICATIONS_PUSH),
    audit: producer(QUEUE_NAMES.AUDIT, JOB_CAPABILITIES.AUDIT_RECORD),
    privacyErasure: producer(QUEUE_NAMES.PRIVACY_ERASURE, JOB_CAPABILITIES.PRIVACY_ERASURE),
    privacyExport: producer(QUEUE_NAMES.PRIVACY_EXPORT, JOB_CAPABILITIES.PRIVACY_EXPORT),
    async close() {
      await redis.close();
      await postgres.close();
    },
  };
}
