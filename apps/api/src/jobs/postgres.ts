import { randomUUID } from "node:crypto";
import type {
  DeadLetterSnapshot,
  JobAdminRepository,
  JobReplayPublisher,
  JobSnapshot,
  SecurityAuditWriter,
} from "./admin.js";

export interface SqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

export interface SqlTransaction extends SqlClient {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface SqlTransactionFactory {
  transaction(): Promise<SqlTransaction>;
}

interface JobRow {
  id: string;
  family_id: string | null;
  capability: string;
  status: JobSnapshot["status"];
  current_attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error_code: string | null;
  last_error_class: JobSnapshot["lastErrorClass"] | null;
  trace_id: string | null;
  created_at: string;
  updated_at: string;
  payload: unknown;
}

interface DeadLetterRow {
  id: string;
  job_id: string;
  queue: string;
  reason: string;
  error_code: string | null;
  error_class: DeadLetterSnapshot["errorClass"] | null;
  attempts: number;
  replay_count: number;
  failed_at: string;
  original_created_at: string;
}

export class PostgresJobAdminRepository implements JobAdminRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async getJob(id: string): Promise<JobSnapshot | undefined> {
    const result = await this.query<JobRow>(
      `SELECT id, family_id, capability, status, current_attempt, max_attempts, next_attempt_at,
          last_error_code, last_error_class, trace_id, created_at, updated_at, payload
       FROM jobs WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapJob(row);
  }

  public async getDeadLetter(id: string): Promise<DeadLetterSnapshot | undefined> {
    const result = await this.query<DeadLetterRow>(
      `SELECT id, job_id, queue, reason, error_code, error_class, attempts, replay_count,
          failed_at, original_created_at
       FROM dead_letter_jobs WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapDeadLetter(row);
  }

  public async recordReplay(input: {
    deadLetterId: string;
    replayId: string;
    actorId: string;
    reason: string;
    approvalId: string;
    replayedAt: number;
  }): Promise<void> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `UPDATE dead_letter_jobs SET replay_count = replay_count + 1 WHERE id = $1`,
        [input.deadLetterId],
      );
      await transaction.query(
        `INSERT INTO audit_events (actor_id, action, resource_type, resource_id, outcome, reason, trace_id)
         VALUES ($1, 'dlq.replay', 'dead_letter_job', $2, 'SUCCESS', $3, $4)`,
        [
          isUuid(input.actorId) ? input.actorId : null,
          input.deadLetterId,
          `approval:${input.approvalId} reason:${input.reason}`,
          input.replayId,
        ],
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private query<Row>(text: string, values: readonly unknown[] = []): Promise<SqlResult<Row>> {
    return this.database.transaction().then(async (transaction) => {
      try {
        const result = await transaction.query<Row>(text, values);
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    });
  }
}

/**
 * Local-profile replay publisher: since no live queue/broker is wired yet
 * (see services/worker-core, a separate process not started by apps/api),
 * "publishing" a replay means enqueueing a fresh PENDING row on the same
 * `jobs` table the workers already poll, cloning the original job's
 * capability so an eventual worker run picks it up. Swappable later for a
 * real broker-backed publisher without changing JobAdministrationService.
 */
export class PostgresJobReplayPublisher implements JobReplayPublisher {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async publish(input: {
    replayId: string;
    jobId: string;
    queue: string;
    traceId?: string;
  }): Promise<void> {
    const transaction = await this.database.transaction();
    try {
      const original = await transaction.query<{ family_id: string | null; capability: string; payload: unknown }>(
        `SELECT family_id, capability, payload FROM jobs WHERE id = $1`,
        [input.jobId],
      );
      const source = original.rows[0];
      if (source === undefined) throw new Error("Original job not found for replay.");
      await transaction.query(
        `INSERT INTO jobs (id, family_id, capability, status, idempotency_key, next_attempt_at, trace_id, payload)
         VALUES ($1, $2, $3, 'PENDING', $4, now(), $5, $6::jsonb)`,
        [
          randomUUID(),
          source.family_id,
          source.capability,
          `replay-${input.replayId}`,
          input.traceId ?? null,
          JSON.stringify(source.payload ?? {}),
        ],
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

export class PostgresSecurityAuditWriter implements SecurityAuditWriter {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async append(input: {
    actorId: string;
    action: "job.read" | "dlq.replay";
    resourceId: string;
    outcome: "SUCCESS" | "DENIED" | "FAILED";
    reason?: string;
    traceId: string;
  }): Promise<void> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `INSERT INTO audit_events (actor_id, action, resource_type, resource_id, outcome, reason, trace_id)
         VALUES ($1, $2, 'job', $3, $4, $5, $6)`,
        [
          // "anonymous" (an unauthenticated caller) is not a real user row and
          // would violate audit_events' FK on actor_id; store NULL instead,
          // matching the same nullable-actor pattern the schema already
          // allows for system-originated events.
          isUuid(input.actorId) ? input.actorId : null,
          input.action,
          input.resourceId,
          input.outcome === "DENIED" ? "DENIED" : input.outcome === "FAILED" ? "FAILURE" : "SUCCESS",
          input.reason ?? null,
          input.traceId,
        ],
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function mapJob(row: JobRow): JobSnapshot {
  return {
    id: row.id,
    ...(row.family_id !== null ? { familyId: row.family_id } : {}),
    capability: row.capability,
    status: row.status,
    currentAttempt: row.current_attempt,
    maxAttempts: row.max_attempts,
    nextAttemptAt: new Date(row.next_attempt_at).getTime(),
    ...(row.last_error_code !== null ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_class !== null && row.last_error_class !== undefined
      ? { lastErrorClass: row.last_error_class }
      : {}),
    ...(row.trace_id !== null ? { traceId: row.trace_id } : {}),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function mapDeadLetter(row: DeadLetterRow): DeadLetterSnapshot {
  return {
    id: row.id,
    jobId: row.job_id,
    queue: row.queue,
    reason: row.reason,
    ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
    ...(row.error_class !== null && row.error_class !== undefined ? { errorClass: row.error_class } : {}),
    attempts: row.attempts,
    replayCount: row.replay_count,
    failedAt: new Date(row.failed_at).getTime(),
    originalCreatedAt: new Date(row.original_created_at).getTime(),
  };
}
