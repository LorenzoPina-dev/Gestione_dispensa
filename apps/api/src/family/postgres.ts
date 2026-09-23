import type {
  Family,
  FamilyAuditEvent,
  FamilyCreatedEvent,
  FamilyCreationResult,
  FamilyMembership,
  FamilyRepository,
} from "./service.js";
import type { FamilyInviteRecord, InviteRepository, JoinAttempt } from "./invites.js";
import type { ManagedMembership, MembershipRepository } from "./membership.js";
import { randomUUID } from "crypto";

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

  public async getById(familyId: string): Promise<Family | undefined> {
    const result = await this.database.transaction();
    try {
      const rows = await result.query<{ id: string; display_name: string; creator_user_id: string; locale: string; timezone: string; unit_system: Family["unitSystem"]; status: Family["status"]; version: number; created_at: string; updated_at: string }>(
        `SELECT id, display_name, creator_user_id, locale, timezone, unit_system, status, version, created_at, updated_at FROM families WHERE id = $1`,
        [familyId],
      );
      await result.commit();
      const row = rows.rows[0];
      return row === undefined ? undefined : {
        id: row.id, displayName: row.display_name, creatorUserId: row.creator_user_id, locale: row.locale,
        timezone: row.timezone, unitSystem: row.unit_system, status: row.status, version: row.version,
        createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
      };
    } catch (error) { await result.rollback(); throw error; }
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
  family_id?: string;
  role?: FamilyInviteRecord["role"];
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

  public async findByFallbackCodeHash(fallbackCodeHash: string): Promise<FamilyInviteRecord | undefined> {
    const result = await this.query<InviteRow>(
      `SELECT id, family_id, created_by, role, encode(token_hash, 'hex') AS token_hash,
        encode(fallback_code_hash, 'hex') AS fallback_code_hash, status, expires_at, consumed_at,
        revoked_at, created_at
       FROM family_invites WHERE fallback_code_hash = decode($1, 'hex')`,
      [fallbackCodeHash],
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

  public async listByFamily(familyId: string): Promise<FamilyInviteRecord[]> {
    const result = await this.query<InviteRow>(
      `SELECT id, family_id, created_by, role, encode(token_hash, 'hex') AS token_hash,
        encode(fallback_code_hash, 'hex') AS fallback_code_hash, status, expires_at, consumed_at, revoked_at, created_at
       FROM family_invites WHERE family_id = $1 ORDER BY created_at DESC`, [familyId],
    );
    return result.rows.map(toInvite);
  }

  public async revoke(inviteId: string, familyId: string, now: Date): Promise<boolean> {
    const result = await this.query<{ id: string }>(
      `UPDATE family_invites SET status = 'REVOKED', revoked_at = $3
       WHERE id = $1 AND family_id = $2 AND status = 'CREATED'
       RETURNING id`,
      [inviteId, familyId, now],
    );
    return result.rows[0] !== undefined;
  }

  public async rejectAtomically(input: {
    attemptId: string;
    userId: string;
    now: Date;
  }): Promise<JoinAttempt> {
    const transaction = await this.database.transaction();
    try {
      const attempt = await transaction.query<JoinAttemptRow>(
        `SELECT id, invite_id, user_id, encode(browser_binding_hash, 'hex') AS browser_binding_hash,
          state, expires_at, completed_at, trace_id
         FROM family_join_attempts WHERE id = $1 FOR UPDATE`,
        [input.attemptId],
      );
      const current = attempt.rows[0];
      if (
        current === undefined ||
        (current.state !== "PENDING_AUTHENTICATION" && current.state !== "PENDING_REVIEW")
      ) {
        throw new Error("Join attempt is not available.");
      }
      await transaction.query(
        `UPDATE family_join_attempts SET user_id = $2, state = 'REJECTED', completed_at = $3
         WHERE id = $1`,
        [input.attemptId, input.userId, input.now],
      );
      await transaction.commit();
      return { ...toJoinAttempt(current), userId: input.userId, state: "REJECTED" };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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
      if (current.family_id === undefined || current.role === undefined) {
        throw new Error("Invite has no family context.");
      }

      // 1. Caso "membership pre-esistente in PENDING" (raro ma possibile se un domani
      //    createInvite() inizierà a scriverla): promuovila.
      const updated = await transaction.query<{ id: string }>(
        `UPDATE family_memberships
         SET status = 'ACTIVE', joined_at = $2, invited_by = NULL, updated_at = $2
         WHERE family_id = $1 AND user_id = $3 AND status IN ('PENDING', 'SUSPENDED')
         RETURNING id`,
        [current.family_id, input.now, input.userId],
      );

      // 2. Caso normale: nessuna membership esiste → creala ora.
      if (updated.rows[0] === undefined) {
        const existing = await transaction.query<{ id: string }>(
          `SELECT id FROM family_memberships
           WHERE family_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
          [current.family_id, input.userId],
        );
        if (existing.rows[0] === undefined) {
          await transaction.query(
            `INSERT INTO family_memberships
               (id, family_id, user_id, role, status, joined_at, invited_by, version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'ACTIVE', $5, NULL, 1, $5, $5)`,
            [
              randomUUID(),
              current.family_id,
              input.userId,
              current.role,
              input.now,
            ],
          );
        }
        // Se esisteva già una membership ACTIVE, l'utente era già membro:
        // idempotente, non tocchiamo nulla.
      }

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
        familyId: current.family_id,
        role: current.role,
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

interface MembershipRow {
  id: string;
  family_id: string;
  user_id: string;
  role: ManagedMembership["role"];
  status: ManagedMembership["status"];
  version: number;
  display_name?: string | null;
  email?: string | null;
  avatar?: string | null;
  joined_at?: string | null;
}

export class PostgresMembershipRepository implements MembershipRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async getById(
    familyId: string,
    membershipId: string,
  ): Promise<ManagedMembership | undefined> {
    const result = await this.query<MembershipRow>(
      `SELECT m.id, m.family_id, m.user_id, m.role, m.status, m.version,
              u.display_name, u.email, u.avatar, m.joined_at
       FROM family_memberships m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.id = $1 AND m.family_id = $2`,
      [membershipId, familyId],
    );
    return result.rows[0] === undefined ? undefined : toMembership(result.rows[0]);
  }

  public async listByFamily(familyId: string): Promise<readonly ManagedMembership[]> {
    const result = await this.query<MembershipRow>(
      `SELECT m.id, m.family_id, m.user_id, m.role, m.status, m.version,
              u.display_name, u.email, u.avatar, m.joined_at
       FROM family_memberships m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.family_id = $1 ORDER BY m.joined_at NULLS LAST, m.created_at`,
      [familyId],
    );
    return result.rows.map(toMembership);
  }

  public async countActiveOwners(familyId: string): Promise<number> {
    const result = await this.query<{ count: string | number }>(
      `SELECT count(*)::int AS count FROM family_memberships
       WHERE family_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`,
      [familyId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async updateAtomic(input: {
    familyId: string;
    membershipId: string;
    role: ManagedMembership["role"];
    status: Extract<ManagedMembership["status"], "ACTIVE" | "SUSPENDED">;
  }): Promise<ManagedMembership> {
    const transaction = await this.database.transaction();
    try {
      const updated = await transaction.query<MembershipRow>(
        `UPDATE family_memberships
         SET role = $3, status = $4, version = version + 1, updated_at = now()
         WHERE id = $1 AND family_id = $2 AND status IN ('ACTIVE', 'SUSPENDED')
         RETURNING id, family_id, user_id, role, status, version`,
        [input.membershipId, input.familyId, input.role, input.status],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error("Membership is not available.");
      await transaction.commit();
      return toMembership(row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async removeAtomic(input: {
    familyId: string;
    membershipId: string;
    removedAt: Date;
  }): Promise<void> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `UPDATE family_memberships
         SET status = 'REMOVED', removed_at = $3, version = version + 1, updated_at = $3
         WHERE id = $1 AND family_id = $2 AND status <> 'REMOVED'`,
        [input.membershipId, input.familyId, input.removedAt],
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

function toMembership(row: MembershipRow): ManagedMembership {
  return {
    id: row.id,
    familyId: row.family_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    version: row.version,
    ...(row.display_name ? { name: row.display_name } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.avatar ? { avatar: row.avatar } : {}),
    ...(row.joined_at ? { joinedAt: row.joined_at } : {}),
  };
}

/**
 * Backs `GET /api/v1/families` (FamilyController.listFamilies) — the small set of families a
 * user belongs to, with their role in each. Distinct from PostgresFamilyMembershipReader (a
 * single-family authorization lookup) because this is a cross-family query with no prior use in
 * this codebase.
 */
export class PostgresUserFamiliesReader {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async listFamiliesForUser(
    userId: string,
  ): Promise<readonly { familyId: string; displayName: string; role: string }[]> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<{
        family_id: string;
        display_name: string;
        role: string;
      }>(
        `SELECT m.family_id, f.display_name, m.role
         FROM family_memberships m
         JOIN families f ON f.id = m.family_id
         WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND f.status = 'ACTIVE'
         ORDER BY m.joined_at NULLS LAST, m.created_at`,
        [userId],
      );
      await transaction.commit();
      return result.rows.map((row) => ({
        familyId: row.family_id,
        displayName: row.display_name,
        role: row.role,
      }));
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

interface MembershipContextRow {
  family_id: string;
  user_id: string;
  role: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
  status: "ACTIVE" | "SUSPENDED" | "REMOVED" | "PENDING";
}

/**
 * Reads the caller's membership for a family, used by FamilyController to
 * authorize invite creation ("family.admin"). Kept separate from
 * PostgresMembershipRepository because the controller boundary only needs a
 * read-only lookup by (familyId, userId), not the full membership lifecycle
 * surface.
 */
export class PostgresFamilyMembershipReader {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async getMembership(
    familyId: string,
    userId: string,
  ): Promise<
    { familyId: string; userId: string; role: MembershipContextRow["role"]; status: MembershipContextRow["status"] } | undefined
  > {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<MembershipContextRow>(
        `SELECT family_id, user_id, role, status FROM family_memberships
         WHERE family_id = $1 AND user_id = $2`,
        [familyId, userId],
      );
      await transaction.commit();
      const row = result.rows[0];
      if (row === undefined) return undefined;
      return { familyId: row.family_id, userId: row.user_id, role: row.role, status: row.status };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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
