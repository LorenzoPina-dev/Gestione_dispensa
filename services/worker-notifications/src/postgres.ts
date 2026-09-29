import type { PushRecipient } from "./family-push.js";

export interface SqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

interface RecipientRow {
  user_id: string;
  push_tokens: unknown;
}

/**
 * Real Postgres-backed recipient resolver for family_push_handler, replacing the
 * InMemoryNotificationRepository placeholder for the notifications-queue consumer. Joins active
 * family members (family_memberships) against their opt-in settings
 * (user_notification_settings, added by migration 0017_pantry-optimization-and-new-features.sql)
 * with LEFT JOIN + COALESCE defaults, so a member who has never opened the notification settings
 * screen (and therefore has no row yet) still gets push_enabled = true by default, matching that
 * column's DEFAULT.
 */
export class PostgresFamilyPushRepository {
  private readonly client: SqlClient;

  public constructor(client: SqlClient) {
    this.client = client;
  }

  public async listRecipients(
    familyId: string,
    category: "REORDER" | "INVITE" | "SYSTEM" | "EXPIRY",
  ): Promise<readonly PushRecipient[]> {
    const result = await this.client.query<RecipientRow>(
      `SELECT fm.user_id AS user_id, COALESCE(uns.push_tokens, '[]'::jsonb) AS push_tokens
       FROM family_memberships fm
       LEFT JOIN user_notification_settings uns ON uns.user_id = fm.user_id
       WHERE fm.family_id = $1
         AND fm.status = 'ACTIVE'
         AND COALESCE(uns.push_enabled, true)
         AND ($2 <> 'REORDER' OR COALESCE(uns.reorder_enabled, true))`,
      [familyId, category],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      pushTokens: Array.isArray(row.push_tokens)
        ? row.push_tokens.filter((token): token is string => typeof token === "string")
        : [],
    }));
  }
}
