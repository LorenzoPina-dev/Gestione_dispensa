import { Pool, type PoolClient } from "pg";

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

export interface PostgresClientOptions {
  connectionString: string;
  max?: number;
  statementTimeoutMs?: number;
  idleTimeoutMs?: number;
  ssl?: boolean;
}

/**
 * Resolves a Postgres connection string with the following precedence:
 *  1. DATABASE_URL (explicit, highest precedence)
 *  2. PG* discrete variables (mirrors docker-compose.yml service conventions)
 * Throws if neither is sufficiently specified, so the process fails fast at
 * startup rather than degrading silently into an unconfigured state.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DATABASE_URL?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }

  const host = env.PGHOST?.trim();
  const database = env.PGDATABASE?.trim();
  const user = env.PGUSER?.trim();
  if (host === undefined || database === undefined || user === undefined) {
    throw new Error(
      "DATABASE_URL is not set and PGHOST/PGDATABASE/PGUSER are incomplete; cannot resolve a Postgres connection.",
    );
  }
  const port = env.PGPORT?.trim() ?? "5432";
  const password = env.PGPASSWORD ?? "";
  const auth =
    password.length > 0
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
      : encodeURIComponent(user);
  return `postgresql://${auth}@${host}:${port}/${database}`;
}

/**
 * Real node-postgres backed implementation of the provider-neutral SqlClient /
 * SqlTransaction / SqlTransactionFactory contracts defined independently in
 * each domain's `postgres.ts` repository file (family, catalog, inventory,
 * shopping). Because those contracts are structurally identical, a single
 * PostgresClient instance can be injected wherever either a SqlClient or a
 * SqlTransactionFactory is expected — one connection pool safely serves every
 * domain repository.
 *
 * Verified against a live PostgreSQL 16 instance (all 7 repository
 * migrations applied) with an end-to-end family creation + invite + accept
 * flow, including a forced-failure test proving atomic rollback leaves no
 * orphaned rows. See apps/api/tests/postgres-client.integration.test.mjs.
 */
export class PostgresClient implements SqlClient, SqlTransactionFactory {
  private readonly pool: Pool;

  private constructor(pool: Pool) {
    this.pool = pool;
  }

  public static create(options: PostgresClientOptions): PostgresClient {
    const pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      statement_timeout: options.statementTimeoutMs ?? 5_000,
      idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
      ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
    });
    return new PostgresClient(pool);
  }

  public async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlResult<Row>> {
    const result = await this.pool.query(text, values as unknown[]);
    return { rows: result.rows as Row[] };
  }

  public async transaction(): Promise<SqlTransaction> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
    } catch (error) {
      client.release();
      throw error;
    }
    return new PostgresTransaction(client);
  }

  /** Cheap liveness probe used by the /health/ready endpoint. */
  public async ping(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgresTransaction implements SqlTransaction {
  private readonly client: PoolClient;
  private settled = false;

  public constructor(client: PoolClient) {
    this.client = client;
  }

  public async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlResult<Row>> {
    const result = await this.client.query(text, values as unknown[]);
    return { rows: result.rows as Row[] };
  }

  public async commit(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    try {
      await this.client.query("COMMIT");
    } finally {
      this.client.release();
    }
  }

  public async rollback(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    try {
      await this.client.query("ROLLBACK");
    } finally {
      this.client.release();
    }
  }
}
