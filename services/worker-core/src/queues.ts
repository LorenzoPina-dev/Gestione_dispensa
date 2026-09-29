import type { JobRepository } from "./repository.js";
import type { QueueAdapter } from "./queue.js";
import { jobMessage } from "./worker.js";

/**
 * Canonical Redis queue names for the whole system. These are the literal keys the refactoring
 * plan asked for (receipt-ocr-queue / off-sync-queue / notifications-queue / audit-queue) --
 * kept in one place so a producer and its worker can never drift apart on the string literal.
 *
 * ARCHITECTURE NOTE (why not BullMQ): this repository already has a mature, transactional
 * job/queue stack in this same package -- PostgresJobRepository (the `jobs`/`job_attempts`/
 * `dead_letter_jobs` tables, see infra/postgres/init/002_jobs.sql) as the durable source of
 * truth, RedisQueueAdapter (Redis lists + BRPOPLPUSH, see redis-queue.ts) purely as a low-latency
 * delivery hint, JobWorker for retry/backoff/DLQ, and WorkerProcess for the poll loop -- proven
 * end-to-end against live Postgres+Redis (see run.ts's doc comment). Introducing BullMQ alongside
 * it would mean two incompatible queueing paradigms (two different persistence models, two
 * separate retry/DLQ semantics, two operational runbooks) for no functional gain: every property
 * BullMQ would bring (persistence, retries, backoff, dead-lettering) already exists here. The
 * four queues below are therefore new *capabilities* on the existing stack, not a new framework.
 */
export const QUEUE_NAMES = {
  RECEIPT_OCR: "receipt-ocr-queue",
  OFF_SYNC: "off-sync-queue",
  NOTIFICATIONS: "notifications-queue",
  AUDIT: "audit-queue",
  INVENTORY_RECONCILE: "inventory-reconcile",
  /**
   * Added 2026-09-26 while fixing a confirmed gap: the former core service's PrivacyErasureService and
   * PrivacyExportService were wired at startup with a literal no-op publisher
   * (`{ publish: async () => {} }`, see services/server.ts history), so a GDPR erasure or
   * export request was persisted to PostgreSQL as `REQUESTED`/`PENDING` and then never went
   * anywhere: no queue message, no worker, no eventual `COMPLETED`/`FAILED` transition. Routing
   * these through the same durable job stack as everything else at least makes every request
   * observable (via JobAdministrationService, the operator-only jobs admin surface) and replayable
   * instead of silently stuck. IMPORTANT: this does NOT mean erasure/export are fully implemented
   * end-to-end yet — no consumer/handler exists for these two capabilities anywhere in
   * services/worker-core or elsewhere, and no concrete `PrivacyErasureExecutor.anonymizeFamily` or
   * `PrivacyExportSource.collectFamilyExport` implementation exists in services/privacy either.
   * Building those is separate, higher-risk work (it touches real user-data deletion/export logic)
   * that deserves its own dedicated review — see docs/GAP-ANALYSIS.md.
   */
  PRIVACY_ERASURE: "privacy-erasure-queue",
  PRIVACY_EXPORT: "privacy-export-queue",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * `jobs.capability` values for the four new flows (see JobRecord.capability in job.ts). A
 * capability identifies WHAT the job does; the queue name identifies WHICH Redis list carries its
 * delivery hint. Kept distinct (rather than reusing the queue name as the capability) because a
 * capability could later be served by more than one queue/priority lane without a schema change.
 */
export const JOB_CAPABILITIES = {
  RECEIPT_OCR: "receipts.ocr",
  OFF_SYNC: "catalog.off-sync",
  NOTIFICATIONS_PUSH: "notifications.push",
  AUDIT_RECORD: "audit.record",
  /** See the QUEUE_NAMES.PRIVACY_ERASURE / PRIVACY_EXPORT comment above for context and caveats. */
  PRIVACY_ERASURE: "privacy.erasure",
  PRIVACY_EXPORT: "privacy.export",
} as const;

export interface EnqueueInput {
  readonly familyId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Must be stable for the same logical unit of work (e.g. `receipt:${receiptId}`,
   * `audit:${eventId}`, `notification:${userId}:${dedupeKey}`) so retried or duplicated HTTP
   * requests enqueue AT MOST one job -- see JobRepository.create's idempotency-key upsert.
   */
  readonly idempotencyKey: string;
  readonly maxAttempts?: number;
  readonly traceId?: string;
}

/**
 * Thin producer wrapping the existing job/queue stack so any service (the former core service,
 * worker-integrations, worker-notifications) can enqueue work for one of the four new async
 * flows in one call, instead of every call site re-deriving the create()+publish() sequence
 * (and its failure semantics) by hand.
 */
export class JobProducer {
  private readonly repository: JobRepository;
  private readonly queue: QueueAdapter<{ jobId: string }>;
  private readonly queueName: string;
  private readonly capability: string;
  private readonly now: () => number;

  public constructor(
    repository: JobRepository,
    queue: QueueAdapter<{ jobId: string }>,
    queueName: string,
    capability: string,
    now: () => number = Date.now,
  ) {
    this.repository = repository;
    this.queue = queue;
    this.queueName = queueName;
    this.capability = capability;
    this.now = now;
  }

  /**
   * Persists the job row (the durable source of truth -- survives even if Redis is briefly
   * unavailable or a message is lost) and publishes its delivery hint to Redis. If a job with the
   * same idempotencyKey+capability already exists, repository.create returns that SAME row
   * (see PostgresJobRepository/InMemoryJobRepository) and this method still (re-)publishes a
   * queue message for it: a no-op if a worker already claimed/finished it, and a useful recovery
   * if the original publish never reached Redis.
   */
  public async enqueue(input: EnqueueInput): Promise<{ jobId: string; queue: string }> {
    const job = await this.repository.create({
      ...(input.familyId === undefined ? {} : { familyId: input.familyId }),
      capability: this.capability,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 5,
      ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
      now: this.now(),
    });
    await this.queue.publish(jobMessage(job, this.queueName));
    return { jobId: job.id, queue: this.queueName };
  }
}
