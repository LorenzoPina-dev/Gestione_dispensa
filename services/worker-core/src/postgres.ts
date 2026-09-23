import { randomUUID } from "node:crypto";
import type { DeadLetter, JobAttempt, JobRecord, JobStatus } from "./job.js";
import type { InboxRepository, JobRepository } from "./repository.js";
import type { ReconciliationRepository } from "./handlers.js";

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
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: JobStatus;
  current_attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  result_ref: string | null;
  last_error_code: string | null;
  last_error_class: "TRANSIENT" | "PERMANENT" | null;
  trace_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Real PostgreSQL-backed implementation of JobRepository, using the `jobs`
 * table (from infra/postgres/init/002_jobs.sql, applied by Docker's
 * initdb hook). Verified against a live PostgreSQL 16 + Redis 7 pair: a
 * message published to a real Redis list, received by JobWorker, claimed
 * from a real `jobs` row, executed, and transitioned to COMPLETED, with the
 * row's `updated_at`/`current_attempt` reflecting the real state after the
 * run (see run.ts / the worker-core integration test).
 *
 * `job.payload`/`result` are stored as jsonb; unlike apps/api's SqlClient
 * contract (which passes raw query params straight to `pg`), this repository
 * does its own JSON.stringify/parse at the boundary since JobRecord's
 * `payload`/`result` fields are already parsed objects by the time they
 * reach this class.
 */
export class PostgresJobRepository implements JobRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async create(input: Parameters<JobRepository["create"]>[0]): Promise<JobRecord> {
    const transaction = await this.database.transaction();
    try {
      const existing = await transaction.query<JobRow>(
        `SELECT id, family_id, capability, payload, idempotency_key, status, current_attempt,
            max_attempts, next_attempt_at, result_ref, last_error_code, last_error_class,
            trace_id, created_at, updated_at
         FROM jobs WHERE capability = $1 AND idempotency_key = $2`,
        [input.capability, input.idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        await transaction.commit();
        return mapJob(existing.rows[0]);
      }
      const inserted = await transaction.query<JobRow>(
        `INSERT INTO jobs
          (id, family_id, capability, status, idempotency_key, max_attempts, next_attempt_at, trace_id, payload)
         VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8::jsonb)
         RETURNING id, family_id, capability, payload, idempotency_key, status, current_attempt,
           max_attempts, next_attempt_at, result_ref, last_error_code, last_error_class,
           trace_id, created_at, updated_at`,
        [
          randomUUID(),
          input.familyId ?? null,
          input.capability,
          input.idempotencyKey,
          input.maxAttempts,
          new Date(input.now),
          input.traceId ?? null,
          JSON.stringify(input.payload),
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Job insert returned no row.");
      await transaction.commit();
      return mapJob(row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async get(id: string): Promise<JobRecord | undefined> {
    const result = await this.query<JobRow>(
      `SELECT id, family_id, capability, payload, idempotency_key, status, current_attempt,
          max_attempts, next_attempt_at, result_ref, last_error_code, last_error_class,
          trace_id, created_at, updated_at
       FROM jobs WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? undefined : mapJob(result.rows[0]);
  }

  public async claim(id: string, now: number): Promise<JobRecord | undefined> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<JobRow>(
        `UPDATE jobs
         SET status = 'PROCESSING', current_attempt = current_attempt + 1, updated_at = $2
         WHERE id = $1
           AND status NOT IN ('CANCELLED', 'COMPLETED', 'FAILED')
           AND next_attempt_at <= $2
         RETURNING id, family_id, capability, payload, idempotency_key, status, current_attempt,
           max_attempts, next_attempt_at, result_ref, last_error_code, last_error_class,
           trace_id, created_at, updated_at`,
        [id, new Date(now)],
      );
      await transaction.commit();
      const row = result.rows[0];
      return row === undefined ? undefined : mapJob(row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async cancel(id: string, now: number): Promise<JobRecord> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `UPDATE jobs SET status = 'CANCELLED', updated_at = $2
         WHERE id = $1 AND status IN ('PENDING', 'DEGRADED')`,
        [id, new Date(now)],
      );
      const result = await transaction.query<JobRow>(
        `SELECT id, family_id, capability, payload, idempotency_key, status, current_attempt,
            max_attempts, next_attempt_at, result_ref, last_error_code, last_error_class,
            trace_id, created_at, updated_at
         FROM jobs WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error(`Job ${id} not found`);
      await transaction.commit();
      return mapJob(row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async transition(
    id: string,
    status: JobStatus,
    now: number,
    details: Parameters<JobRepository["transition"]>[3] = {},
  ): Promise<JobRecord> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `UPDATE jobs
         SET status = $2,
             updated_at = $3,
             last_error_code = COALESCE($4, last_error_code),
             last_error_class = COALESCE($5, last_error_class),
             next_attempt_at = COALESCE($6, next_attempt_at)
         WHERE id = $1`,
        [
          id,
          status,
          new Date(now),
          details.errorCode ?? null,
          details.errorClass ?? null,
          details.nextAttemptAt === undefined ? null : new Date(details.nextAttemptAt),
        ],
      );
      if (details.result !== undefined) {
        await transaction.query(`UPDATE jobs SET result_ref = $2 WHERE id = $1`, [
          id,
          JSON.stringify(details.result),
        ]);
      }
      const result = await transaction.query<JobRow>(
        `SELECT id, family_id, capability, payload, idempotency_key, status, current_attempt,
            max_attempts, next_attempt_at, result_ref, last_error_code, last_error_class,
            trace_id, created_at, updated_at
         FROM jobs WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error(`Job ${id} not found`);
      await transaction.commit();
      return mapJob(row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async addAttempt(attempt: JobAttempt): Promise<void> {
    await this.query(
      `INSERT INTO job_attempts (id, job_id, attempt, started_at, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [attempt.id, attempt.jobId, attempt.attempt, new Date(attempt.startedAt), attempt.status],
    );
  }

  public async updateAttempt(
    id: string,
    update: Parameters<JobRepository["updateAttempt"]>[1],
  ): Promise<void> {
    await this.query(
      `UPDATE job_attempts
       SET finished_at = COALESCE($2, finished_at),
           status = COALESCE($3, status),
           error_code = COALESCE($4, error_code),
           error_class = COALESCE($5, error_class),
           duration_ms = COALESCE($6, duration_ms)
       WHERE id = $1`,
      [
        id,
        update.finishedAt === undefined ? null : new Date(update.finishedAt),
        update.status ?? null,
        update.errorCode ?? null,
        update.errorClass ?? null,
        update.durationMs ?? null,
      ],
    );
  }

  public async addDeadLetter(deadLetter: DeadLetter): Promise<void> {
    await this.query(
      `INSERT INTO dead_letter_jobs
        (id, job_id, queue, reason, error_code, error_class, attempts, replay_count, failed_at, original_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        deadLetter.id,
        deadLetter.jobId,
        deadLetter.queue,
        deadLetter.reason,
        deadLetter.errorCode ?? null,
        deadLetter.errorClass ?? null,
        deadLetter.attempts,
        deadLetter.replayCount,
        new Date(deadLetter.failedAt),
        new Date(deadLetter.originalCreatedAt),
      ],
    );
  }

  public async listDeadLetters(): Promise<readonly DeadLetter[]> {
    const result = await this.query<{
      id: string;
      job_id: string;
      queue: string;
      reason: string;
      error_code: string | null;
      error_class: "TRANSIENT" | "PERMANENT" | null;
      attempts: number;
      replay_count: number;
      failed_at: string;
      original_created_at: string;
    }>(
      `SELECT id, job_id, queue, reason, error_code, error_class, attempts, replay_count,
          failed_at, original_created_at
       FROM dead_letter_jobs ORDER BY failed_at DESC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      queue: row.queue,
      reason: row.reason,
      errorCode: row.error_code ?? undefined,
      errorClass: row.error_class ?? undefined,
      attempts: row.attempts,
      replayCount: row.replay_count,
      failedAt: new Date(row.failed_at).getTime(),
      originalCreatedAt: new Date(row.original_created_at).getTime(),
    }));
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

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    ...(row.family_id === null ? {} : { familyId: row.family_id }),
    capability: row.capability,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    currentAttempt: row.current_attempt,
    maxAttempts: row.max_attempts,
    nextAttemptAt: new Date(row.next_attempt_at).getTime(),
    ...(row.result_ref === null ? {} : { result: JSON.parse(row.result_ref) }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    ...(row.last_error_class === null ? {} : { lastErrorClass: row.last_error_class }),
    ...(row.trace_id === null ? {} : { traceId: row.trace_id }),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

/**
 * Real PostgreSQL-backed implementation of InboxRepository, using the
 * `inbox_events` table. `begin()` inserts a row and returns true only if
 * this is the first time (consumer_name, event_id) has been seen, relying
 * on the table's UNIQUE constraint for the actual deduplication guarantee
 * rather than a SELECT-then-INSERT race.
 */
export class PostgresInboxRepository implements InboxRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async begin(consumerName: string, eventId: string, now: number): Promise<boolean> {
    void now;
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<{ id: string }>(
        `INSERT INTO inbox_events (consumer_name, event_id)
         VALUES ($1, $2)
         ON CONFLICT (consumer_name, event_id) DO NOTHING
         RETURNING id`,
        [consumerName, eventId],
      );
      await transaction.commit();
      return result.rows[0] !== undefined;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async complete(consumerName: string, eventId: string, now: number): Promise<void> {
    void now;
    await this.query(
      `UPDATE inbox_events SET processed_at = now(), outcome = 'COMPLETED'
       WHERE consumer_name = $1 AND event_id = $2`,
      [consumerName, eventId],
    );
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
 * Backs the "inventory.reconcile" capability seen elsewhere in this session
 * (apps/api's jobs admin routes use the same capability name for a seeded
 * test job). Drift is defined as: the stock_items.current_quantity value
 * diverging from the net effect of its stock_movements (RECEIPT adds,
 * CONSUMPTION/WASTE subtract, ADJUSTMENT/TRANSFER are treated as
 * corrections already reflected in current_quantity and excluded from the
 * expected-value recomputation).
 */
export class PostgresReconciliationRepository implements ReconciliationRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async findInventoryDrift(
    familyId?: string,
  ): Promise<readonly { stockItemId: string; expected: number; actual: number }[]> {
    const result = await this.query<{ stock_item_id: string; expected: string; actual: string }>(
      `SELECT
         s.id AS stock_item_id,
         COALESCE(SUM(
           CASE m.kind
             WHEN 'RECEIPT' THEN m.quantity
             WHEN 'CONSUMPTION' THEN -m.quantity
             WHEN 'WASTE' THEN -m.quantity
             ELSE 0
           END
         ), 0) AS expected,
         s.current_quantity AS actual
       FROM stock_items s
       LEFT JOIN stock_movements m ON m.stock_item_id = s.id
       WHERE s.status = 'ACTIVE' AND ($1::uuid IS NULL OR s.family_id = $1)
       GROUP BY s.id, s.current_quantity
       HAVING COALESCE(SUM(
         CASE m.kind
           WHEN 'RECEIPT' THEN m.quantity
           WHEN 'CONSUMPTION' THEN -m.quantity
           WHEN 'WASTE' THEN -m.quantity
           ELSE 0
         END
       ), 0) <> s.current_quantity`,
      [familyId ?? null],
    );
    return result.rows.map((row) => ({
      stockItemId: row.stock_item_id,
      expected: Number(row.expected),
      actual: Number(row.actual),
    }));
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
