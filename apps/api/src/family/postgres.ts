import type {
  Family,
  FamilyAuditEvent,
  FamilyCreatedEvent,
  FamilyCreationResult,
  FamilyMembership,
  FamilyRepository,
} from "./service.js";
import type { FamilyInviteRecord, InviteRepository, JoinAttempt } from "./invites.js";

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

export class PostgresFamilyRepository implements FamilyRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async createFamilyAtomic(input: {
    family: Family;
    membership: FamilyMembership;
    audit: FamilyAuditEvent;
    event: FamilyCreatedEvent;
  }): Promise<FamilyCreationResult> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `INSERT INTO families
          (id, display_name, creator_user_id, locale, timezone, unit_system, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.family.id,
          input.family.displayName,
          input.family.creatorUserId,
          input.family.locale,
          input.family.timezone,
          input.family.unitSystem,
          input.family.status,
          input.family.version,
          input.family.createdAt,
          input.family.updatedAt,
        ],
      );
      await transaction.query(
        `INSERT INTO family_memberships
          (id, family_id, user_id, role, status, joined_at, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $6)`,
        [
          input.membership.id,
          input.membership.familyId,
          input.membership.userId,
          input.membership.role,
          input.membership.status,
          input.membership.joinedAt,
          input.membership.version,
        ],
      );
      await transaction.query(
        `INSERT INTO audit_events
          (family_id, actor_id, action, resource_type, resource_id, outcome, trace_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.audit.familyId,
          input.audit.actorId,
          input.audit.action,
          input.audit.resourceType,
          input.audit.resourceId,
          input.audit.outcome,
          input.audit.traceId,
        ],
      );
      await transaction.query(
        `INSERT INTO outbox_events
          (event_id, event_type, event_version, aggregate_type, aggregate_id, family_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          input.event.eventId,
          input.event.eventType,
          input.event.eventVersion,
          input.event.aggregateType,
          input.event.aggregateId,
          input.event.familyId,
          JSON.stringify(input.event.payload),
        ],
      );
      await transaction.commit();
      return input;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

interface InviteRow {
  id: string;
  family_id: string;
  created_by: string;
  role: FamilyInviteRecord["role"];
  token_hash: string;
  fallback_code_hash: string;
  status: FamilyInviteRecord["status"];
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface JoinAttemptRow {
  id: string;
  invite_id: string;
  user_id: string | null;
  browser_binding_hash: string;
  state: JoinAttempt["state"];
  expires_at: string;
  completed_at?: string | null;
  trace_id: string;
}

export class PostgresInviteRepository implements InviteRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async createInvite(record: FamilyInviteRecord): Promise<void> {
    await this.database.transaction().then(async (transaction) => {
      try {
        await transaction.query(
          `INSERT INTO family_invites
            (id, family_id, created_by, role, token_hash, fallback_code_hash, status, expires_at, created_at)
           VALUES ($1, $2, $3, $4, decode($5, 'hex'), decode($6, 'hex'), $7, $8, $9)`,
          [
            record.id,
            record.familyId,
            record.createdBy,
            record.role,
            record.tokenHash,
            record.fallbackCodeHash,
            record.status,
            record.expiresAt,
            record.createdAt,
          ],
        );
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    });
  }

  public async findByTokenHash(tokenHash: string): Promise<FamilyInviteRecord | undefined> {
    const result = await this.query<InviteRow>(
      `SELECT id, family_id, created_by, role, encode(token_hash, 'hex') AS token_hash,
        encode(fallback_code_hash, 'hex') AS fallback_code_hash, status, expires_at, consumed_at,
        revoked_at, created_at
       FROM family_invites WHERE token_hash = decode($1, 'hex')`,
      [tokenHash],
    );
    return result.rows[0] === undefined ? undefined : toInvite(result.rows[0]);
  }

  public async createJoinAttempt(attempt: JoinAttempt): Promise<void> {
    await this.query(
      `INSERT INTO family_join_attempts
        (id, invite_id, user_id, browser_binding_hash, state, expires_at, trace_id)
       VALUES ($1, $2, $3, decode($4, 'hex'), $5, $6, $7)`,
      [
        attempt.id,
        attempt.inviteId,
        attempt.userId ?? null,
        attempt.browserBindingHash,
        attempt.state,
        attempt.expiresAt,
        attempt.traceId,
      ],
    );
  }

  public async getJoinAttempt(id: string): Promise<JoinAttempt | undefined> {
    const result = await this.query<JoinAttemptRow>(
      `SELECT id, invite_id, user_id, encode(browser_binding_hash, 'hex') AS browser_binding_hash,
        state, expires_at, completed_at, trace_id
       FROM family_join_attempts WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? undefined : toJoinAttempt(result.rows[0]);
  }

  public async markExpired(inviteId: string, now: Date): Promise<void> {
    await this.query(
      `UPDATE family_invites SET status = 'EXPIRED'
       WHERE id = $1 AND status = 'CREATED' AND expires_at <= $2`,
      [inviteId, now],
    );
  }

  public async revoke(inviteId: string, actorId: string, now: Date): Promise<void> {
    await this.query(
      `UPDATE family_invites SET status = 'REVOKED', revoked_at = $3
       WHERE id = $1 AND created_by = $2 AND status = 'CREATED'`,
      [inviteId, actorId, now],
    );
  }

  public async acceptAtomically(input: {
    attemptId: string;
    userId: string;
    now: Date;
    consentVersion: string;
  }): Promise<JoinAttempt> {
    const transaction = await this.database.transaction();
    try {
      const attempt = await transaction.query<JoinAttemptRow>(
        `SELECT a.id, a.invite_id, a.user_id, encode(a.browser_binding_hash, 'hex') AS browser_binding_hash,
          a.state, a.expires_at, a.completed_at, a.trace_id, i.family_id, i.role
         FROM family_join_attempts a
         JOIN family_invites i ON i.id = a.invite_id
         WHERE a.id = $1 FOR UPDATE`,
        [input.attemptId],
      );
      const current = attempt.rows[0];
      if (current === undefined) throw new Error("Join attempt is not available.");
      await transaction.query(
        `UPDATE family_memberships
         SET status = 'ACTIVE', joined_at = $2, invited_by = NULL, updated_at = $2
         WHERE family_id = (SELECT family_id FROM family_invites WHERE id = $1)
           AND user_id = $3 AND status = 'PENDING'`,
        [current.invite_id, input.now, input.userId],
      );
      await transaction.query(
        `UPDATE family_join_attempts SET user_id = $2, state = 'ACCEPTED', completed_at = $3
         WHERE id = $1`,
        [input.attemptId, input.userId, input.now],
      );
      await transaction.query(
        `UPDATE family_invites SET status = 'CONSUMED', consumed_at = $2
         WHERE id = $1 AND status = 'CREATED'`,
        [current.invite_id, input.now],
      );
      await transaction.commit();
      return {
        ...toJoinAttempt(current),
        userId: input.userId,
        state: "ACCEPTED",
      };
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

function toInvite(row: InviteRow): FamilyInviteRecord {
  return {
    id: row.id,
    familyId: row.family_id,
    createdBy: row.created_by,
    role: row.role,
    tokenHash: row.token_hash,
    fallbackCodeHash: row.fallback_code_hash,
    status: row.status,
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at === null ? undefined : new Date(row.consumed_at),
    revokedAt: row.revoked_at === null ? undefined : new Date(row.revoked_at),
    createdAt: new Date(row.created_at),
  };
}

function toJoinAttempt(row: JoinAttemptRow): JoinAttempt {
  return {
    id: row.id,
    inviteId: row.invite_id,
    userId: row.user_id ?? undefined,
    browserBindingHash: row.browser_binding_hash,
    state: row.state,
    expiresAt: new Date(row.expires_at),
    traceId: row.trace_id,
  };
}
