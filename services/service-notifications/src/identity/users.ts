import type { SqlTransactionFactory } from "../family/postgres.js";

export interface UserProfile {
  id: string;
  email?: string;
  displayName?: string;
  avatar?: string;
}

export class PostgresUserProfileRepository {
  public constructor(private readonly database: SqlTransactionFactory) {}

  public async upsertFromOidc(input: {
    id: string;
    email?: string;
    displayName?: string;
    avatar?: string;
  }): Promise<UserProfile> {
    const tx = await this.database.transaction();
    try {
      const result = await tx.query<{
        id: string;
        email: string | null;
        display_name: string | null;
        avatar: string | null;
      }>(
        `INSERT INTO users (id, email, display_name, avatar)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
           SET email = COALESCE(EXCLUDED.email, users.email),
               display_name = COALESCE(EXCLUDED.display_name, users.display_name),
               avatar = COALESCE(EXCLUDED.avatar, users.avatar),
               updated_at = now()
         RETURNING id, email, display_name, avatar`,
        [input.id, input.email ?? null, input.displayName ?? null, input.avatar ?? null],
      );
      await tx.commit();
      const row = result.rows[0];
      if (!row) throw new Error("User profile upsert returned no row.");
      return {
        id: row.id,
        ...(row.email ? { email: row.email } : {}),
        ...(row.display_name ? { displayName: row.display_name } : {}),
        ...(row.avatar ? { avatar: row.avatar } : {}),
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async getActiveFamilyId(id: string): Promise<string | undefined> {
    const tx = await this.database.transaction();
    try {
      const result = await tx.query<{ family_id: string }>(
        `SELECT family_id FROM family_memberships
         WHERE user_id = $1 AND status = 'ACTIVE'
         ORDER BY CASE WHEN role = 'OWNER' THEN 0 ELSE 1 END, joined_at NULLS LAST, created_at
         LIMIT 1`,
        [id],
      );
      await tx.commit();
      return result.rows[0]?.family_id;
    } catch (error) { await tx.rollback(); throw error; }
  }

  public async getById(id: string): Promise<UserProfile | undefined> {
    const tx = await this.database.transaction();
    try {
      const result = await tx.query<{
        id: string; email: string | null; display_name: string | null; avatar: string | null;
      }>(
        `SELECT id, email, display_name, avatar FROM users WHERE id = $1 AND status <> 'ERASED'`,
        [id],
      );
      await tx.commit();
      const row = result.rows[0];
      return row ? {
        id: row.id,
        ...(row.email ? { email: row.email } : {}),
        ...(row.display_name ? { displayName: row.display_name } : {}),
        ...(row.avatar ? { avatar: row.avatar } : {}),
      } : undefined;
    } catch (error) { await tx.rollback(); throw error; }
  }
}
