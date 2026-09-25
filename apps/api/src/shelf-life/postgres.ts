import type { ExpiringLot, ExpiryScanRepository } from "./expiry-scan.js";
import type { ShelfLifeRule, ShelfLifeRuleRepository, StorageKind } from "./service.js";

export interface SqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface SqlClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

const STORAGE_KINDS: readonly StorageKind[] = ["PANTRY", "FRIDGE", "FREEZER", "CELLAR", "OTHER"];

interface ShelfLifeRuleRow {
  category: string;
  storage_kind: StorageKind;
  estimated_days: number | string | null;
  notify_days_before: number | string;
}

export class PostgresShelfLifeRuleRepository implements ShelfLifeRuleRepository {
  private readonly database: SqlClient;

  public constructor(database: SqlClient) {
    this.database = database;
  }

  public async findRule(
    category: string | undefined,
    storageKind: StorageKind,
  ): Promise<ShelfLifeRule | undefined> {
    if (!category) return undefined;
    const result = await this.database.query<ShelfLifeRuleRow>(
      `SELECT category, storage_kind, estimated_days, notify_days_before
       FROM shelf_life_rules WHERE category = $1 AND storage_kind = $2`,
      [category, storageKind],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapRule(row);
  }
}

function mapRule(row: ShelfLifeRuleRow): ShelfLifeRule {
  return {
    category: row.category,
    storageKind: row.storage_kind,
    estimatedDays: row.estimated_days === null ? undefined : Number(row.estimated_days),
    notifyDaysBefore: Number(row.notify_days_before),
  };
}

interface ExpiringLotRow {
  lot_id: string;
  family_id: string;
  product_name: string;
  category: string | null;
  location_kind: string | null;
  quantity: string | number | null;
  unit: string;
  expires_at: string;
}

/**
 * Backs ExpiryScanService. Joins stock_lots -> stock_items -> products (for category) and an
 * optional locations row (for storage kind), mirroring the same joins InventoryRepository's
 * listByFamily already does -- see inventory/postgres.ts.
 */
export class PostgresExpiryScanRepository implements ExpiryScanRepository {
  private readonly database: SqlClient;

  public constructor(database: SqlClient) {
    this.database = database;
  }

  public async findCandidateLots(now: Date, horizonDays: number): Promise<readonly ExpiringLot[]> {
    const horizon = new Date(now);
    horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
    const result = await this.database.query<ExpiringLotRow>(
      `SELECT sl.id AS lot_id, si.family_id, p.canonical_name AS product_name, p.category,
              l.kind AS location_kind, sl.quantity_snapshot AS quantity, si.unit, sl.expires_at
       FROM stock_lots sl
       JOIN stock_items si ON si.id = sl.stock_item_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN locations l ON l.id = si.location_id
       WHERE si.status = 'ACTIVE'
         AND sl.expires_at IS NOT NULL
         AND sl.expiry_notified_at IS NULL
         AND sl.expires_at <= $1
         AND COALESCE(sl.quantity_snapshot, 0) > 0`,
      [horizon],
    );
    return result.rows.map((row) => ({
      lotId: row.lot_id,
      familyId: row.family_id,
      productName: row.product_name,
      category: row.category ?? undefined,
      storageKind: toStorageKind(row.location_kind),
      quantity: row.quantity === null ? 0 : Number(row.quantity),
      unit: row.unit,
      expiresAt: new Date(row.expires_at),
    }));
  }

  public async markNotified(lotId: string, notifiedAt: Date): Promise<void> {
    await this.database.query(`UPDATE stock_lots SET expiry_notified_at = $2 WHERE id = $1`, [
      lotId,
      notifiedAt,
    ]);
  }
}

function toStorageKind(raw: string | null): StorageKind {
  return raw !== null && (STORAGE_KINDS as readonly string[]).includes(raw)
    ? (raw as StorageKind)
    : "OTHER";
}
