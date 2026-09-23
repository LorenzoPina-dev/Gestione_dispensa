import type {
  CreateNotificationCommand,
  Notification,
  NotificationRepository,
} from "./service.js";

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

interface NotificationRow {
  id: string;
  family_id: string;
  category: Notification["category"];
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export class PostgresNotificationRepository implements NotificationRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async createAtomic(
    input: CreateNotificationCommand & { id: string; createdAt: Date },
  ): Promise<Notification> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `INSERT INTO notifications (id, family_id, category, title, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.id, input.familyId, input.category, input.title, input.body, input.createdAt],
      );
      await transaction.commit();
      return {
        id: input.id,
        familyId: input.familyId,
        category: input.category,
        title: input.title,
        body: input.body,
        readAt: undefined,
        createdAt: input.createdAt,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async listByFamily(familyId: string): Promise<Notification[]> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<NotificationRow>(
        `SELECT id, family_id, category, title, body, read_at, created_at
         FROM notifications WHERE family_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [familyId],
      );
      await transaction.commit();
      return result.rows.map(mapRow);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async markReadAtomic(input: {
    familyId: string;
    id: string;
    readAt: Date;
  }): Promise<Notification | undefined> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<NotificationRow>(
        `UPDATE notifications SET read_at = COALESCE(read_at, $3)
         WHERE id = $1 AND family_id = $2
         RETURNING id, family_id, category, title, body, read_at, created_at`,
        [input.id, input.familyId, input.readAt],
      );
      await transaction.commit();
      const row = result.rows[0];
      return row === undefined ? undefined : mapRow(row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function mapRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    familyId: row.family_id,
    category: row.category,
    title: row.title,
    body: row.body,
    readAt: row.read_at === null ? undefined : new Date(row.read_at),
    createdAt: new Date(row.created_at),
  };
}
