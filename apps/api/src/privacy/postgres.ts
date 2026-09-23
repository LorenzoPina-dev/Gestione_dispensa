import type { ErasureRequest, PrivacyConsent, PrivacyErasureRepository } from "./erasure.js";
import type { ExportArtifactStore, ExportJob, PrivacyExportRepository } from "./export.js";

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

interface ErasureRow {
  id: string;
  family_id: string;
  requester_id: string;
  idempotency_key: string;
  status: ErasureRequest["status"];
  created_at: string;
  completed_at: string | null;
}

export class PostgresPrivacyErasureRepository implements PrivacyErasureRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async createOrGetErasure(input: {
    familyId: string;
    requesterId: string;
    idempotencyKey: string;
    now: number;
  }): Promise<{ request: ErasureRequest; created: boolean }> {
    const transaction = await this.database.transaction();
    try {
      const existing = await transaction.query<ErasureRow>(
        `SELECT id, family_id, requester_id, idempotency_key, status, created_at, completed_at
         FROM privacy_erasure_requests WHERE family_id = $1 AND idempotency_key = $2`,
        [input.familyId, input.idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        await transaction.commit();
        return { request: mapErasure(existing.rows[0]), created: false };
      }
      const inserted = await transaction.query<ErasureRow>(
        `INSERT INTO privacy_erasure_requests (family_id, requester_id, idempotency_key)
         VALUES ($1, $2, $3)
         RETURNING id, family_id, requester_id, idempotency_key, status, created_at, completed_at`,
        [input.familyId, input.requesterId, input.idempotencyKey],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Erasure request insert returned no row.");
      await transaction.commit();
      return { request: mapErasure(row), created: true };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async getErasure(id: string): Promise<ErasureRequest | undefined> {
    const result = await this.query<ErasureRow>(
      `SELECT id, family_id, requester_id, idempotency_key, status, created_at, completed_at
       FROM privacy_erasure_requests WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? undefined : mapErasure(result.rows[0]);
  }

  public async markProcessing(id: string): Promise<ErasureRequest> {
    return this.transition(id, `UPDATE privacy_erasure_requests SET status = 'PROCESSING' WHERE id = $1`, [id]);
  }

  public async completeErasure(id: string, completedAt: number): Promise<ErasureRequest> {
    return this.transition(
      id,
      `UPDATE privacy_erasure_requests SET status = 'COMPLETED', completed_at = $2 WHERE id = $1`,
      [id, new Date(completedAt)],
    );
  }

  public async failErasure(id: string): Promise<ErasureRequest> {
    return this.transition(id, `UPDATE privacy_erasure_requests SET status = 'FAILED' WHERE id = $1`, [id]);
  }

  public async upsertConsent(input: PrivacyConsent): Promise<PrivacyConsent> {
    await this.query(
      `INSERT INTO privacy_consents (user_id, purpose, granted, consent_version, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, purpose)
       DO UPDATE SET granted = $3, consent_version = $4, updated_at = $5`,
      [input.userId, input.purpose, input.granted, input.consentVersion, new Date(input.updatedAt)],
    );
    return input;
  }

  public async listConsents(userId: string): Promise<readonly PrivacyConsent[]> {
    const result = await this.query<{
      user_id: string;
      purpose: string;
      granted: boolean;
      consent_version: string;
      updated_at: string;
    }>(
      `SELECT user_id, purpose, granted, consent_version, updated_at
       FROM privacy_consents WHERE user_id = $1 ORDER BY purpose`,
      [userId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      purpose: row.purpose,
      granted: row.granted,
      consentVersion: row.consent_version,
      updatedAt: new Date(row.updated_at).getTime(),
    }));
  }

  private async transition(
    id: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<ErasureRequest> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(sql, values);
      const result = await transaction.query<ErasureRow>(
        `SELECT id, family_id, requester_id, idempotency_key, status, created_at, completed_at
         FROM privacy_erasure_requests WHERE id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error("Erasure request not found after transition.");
      await transaction.commit();
      return mapErasure(row);
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

function mapErasure(row: ErasureRow): ErasureRequest {
  return {
    id: row.id,
    familyId: row.family_id,
    requesterId: row.requester_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
    ...(row.completed_at === null ? {} : { completedAt: new Date(row.completed_at).getTime() }),
  };
}

interface ExportRow {
  id: string;
  family_id: string;
  owner_id: string;
  idempotency_key: string;
  status: ExportJob["status"];
  artifact_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export class PostgresPrivacyExportRepository implements PrivacyExportRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async createOrGetExport(input: {
    familyId: string;
    ownerId: string;
    idempotencyKey: string;
    now: number;
  }): Promise<{ job: ExportJob; created: boolean }> {
    const transaction = await this.database.transaction();
    try {
      const existing = await transaction.query<ExportRow>(
        `SELECT id, family_id, owner_id, idempotency_key, status, artifact_id, expires_at, created_at
         FROM privacy_export_jobs WHERE family_id = $1 AND idempotency_key = $2`,
        [input.familyId, input.idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        await transaction.commit();
        return { job: mapExport(existing.rows[0]), created: false };
      }
      const inserted = await transaction.query<ExportRow>(
        `INSERT INTO privacy_export_jobs (family_id, owner_id, idempotency_key)
         VALUES ($1, $2, $3)
         RETURNING id, family_id, owner_id, idempotency_key, status, artifact_id, expires_at, created_at`,
        [input.familyId, input.ownerId, input.idempotencyKey],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Export job insert returned no row.");
      await transaction.commit();
      return { job: mapExport(row), created: true };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async getExport(id: string): Promise<ExportJob | undefined> {
    const result = await this.query<ExportRow>(
      `SELECT id, family_id, owner_id, idempotency_key, status, artifact_id, expires_at, created_at
       FROM privacy_export_jobs WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? undefined : mapExport(result.rows[0]);
  }

  public async completeExport(input: {
    id: string;
    artifactId: string;
    expiresAt: number;
  }): Promise<ExportJob> {
    const result = await this.query<ExportRow>(
      `UPDATE privacy_export_jobs
       SET status = 'COMPLETED', artifact_id = $2, expires_at = $3
       WHERE id = $1
       RETURNING id, family_id, owner_id, idempotency_key, status, artifact_id, expires_at, created_at`,
      [input.id, input.artifactId, new Date(input.expiresAt)],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Export job not found for completion.");
    return mapExport(row);
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

function mapExport(row: ExportRow): ExportJob {
  return {
    id: row.id,
    familyId: row.family_id,
    ownerId: row.owner_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    ...(row.artifact_id === null ? {} : { artifactId: row.artifact_id }),
    ...(row.expires_at === null ? {} : { expiresAt: new Date(row.expires_at).getTime() }),
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * Local-profile artifact store: export content lives in its own
 * `export_artifacts` table (see migration 0008) rather than a real
 * MinIO/S3-backed store. Swappable later for a real object-storage-backed
 * implementation without touching PrivacyExportService, since both satisfy
 * the same ExportArtifactStore contract.
 */
export class PostgresExportArtifactStore implements ExportArtifactStore {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async put(input: {
    artifactId: string;
    familyId: string;
    content: Readonly<Record<string, unknown>>;
    expiresAt: number;
  }): Promise<void> {
    // Insert the artifact as its own row (rather than UPDATEing a job row
    // matched by artifact_id, which does not exist on any row yet at this
    // point -- PrivacyExportWorker.process() calls put() *before*
    // repository.completeExport() sets the job's artifact_id). This was
    // caught by running the full erasure/export flow against a live
    // PostgreSQL instance: the naive UPDATE-by-artifact_id approach silently
    // affected zero rows.
    await this.query(
      `INSERT INTO export_artifacts (id, family_id, content, expires_at)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [input.artifactId, input.familyId, JSON.stringify(input.content), new Date(input.expiresAt)],
    );
  }

  public async read(input: {
    artifactId: string;
    familyId: string;
  }): Promise<{
    artifactId: string;
    familyId: string;
    content: Readonly<Record<string, unknown>>;
    expiresAt: number;
  }> {
    const result = await this.query<{ content: Record<string, unknown>; expires_at: string }>(
      `SELECT content, expires_at FROM export_artifacts WHERE id = $1 AND family_id = $2`,
      [input.artifactId, input.familyId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Export artifact is not available.");
    }
    return {
      artifactId: input.artifactId,
      familyId: input.familyId,
      content: row.content,
      expiresAt: new Date(row.expires_at).getTime(),
    };
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

/** Shared audit writer for both erasure and export flows; writes to the same audit_events table used elsewhere. */
export class PostgresPrivacyAuditWriter {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async append(input: {
    actorId: string;
    action: string;
    resourceId: string;
    familyId?: string;
    outcome: "SUCCESS" | "DENIED" | "FAILED";
    traceId: string;
    reason?: string;
  }): Promise<void> {
    // audit_events.resource_id is uuid-typed, but not every privacy resource
    // has a UUID identifier -- a consent's resourceId is its purpose string
    // (e.g. "marketing"). Store non-UUID identifiers in the existing
    // metadata jsonb column instead of failing the insert.
    const resourceIsUuid = isUuid(input.resourceId);
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `INSERT INTO audit_events
          (family_id, actor_id, action, resource_type, resource_id, outcome, reason, trace_id, metadata)
         VALUES ($1, $2, $3, 'privacy', $4, $5, $6, $7, $8::jsonb)`,
        [
          input.familyId ?? null,
          input.actorId,
          input.action,
          resourceIsUuid ? input.resourceId : null,
          input.outcome === "DENIED" ? "DENIED" : input.outcome === "FAILED" ? "FAILURE" : "SUCCESS",
          input.reason ?? null,
          input.traceId,
          JSON.stringify(resourceIsUuid ? {} : { resourceId: input.resourceId }),
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
