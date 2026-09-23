import type {
  CreateStockItemCommand,
  InventoryRepository,
  RecordMovementCommand,
  StockItem,
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

interface StockRow {
  id: string;
  family_id: string;
  product_id: string;
  current_quantity: string | number;
  unit: StockItem["unit"];
  reorder_point: string | number | null;
  version: number;
  status: "ACTIVE";
}

export class PostgresInventoryRepository implements InventoryRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async getById(stockItemId: string): Promise<StockItem | undefined> {
    const tx=await this.database.transaction(); try { const r=await tx.query<StockRow>(`SELECT id, family_id, product_id, current_quantity, unit, reorder_point, version, status FROM stock_items WHERE id=$1 AND status='ACTIVE'`,[stockItemId]); await tx.commit(); const row=r.rows[0]; return row===undefined?undefined:mapStock(row); } catch(e){await tx.rollback();throw e;}
  }

  public async listMovements(stockItemId: string, familyId: string): Promise<readonly Record<string, unknown>[]> {
    const tx=await this.database.transaction(); try { const r=await tx.query(`SELECT id, stock_item_id AS "stockItemId", kind, quantity, unit, source, actor_id AS "actorId", occurred_at AS "occurredAt", created_at AS "createdAt", metadata FROM stock_movements WHERE stock_item_id=$1 AND family_id=$2 ORDER BY occurred_at DESC, created_at DESC`,[stockItemId,familyId]); await tx.commit(); return r.rows; } catch(e){await tx.rollback();throw e;}
  }

  public async createStockItemAtomic(
    input: CreateStockItemCommand & { id: string },
  ): Promise<StockItem> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `INSERT INTO stock_items
          (id, family_id, product_id, package_id, location_id, current_quantity, unit, reorder_point, status, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', 1)`,
        [
          input.id,
          input.familyId,
          input.productId,
          input.packageId ?? null,
          input.locationId ?? null,
          input.quantity,
          input.unit,
          input.reorderPoint ?? null,
        ],
      );
      await transaction.commit();
      return {
        id: input.id,
        familyId: input.familyId,
        productId: input.productId,
        quantity: input.quantity,
        unit: input.unit,
        reorderPoint: input.reorderPoint,
        version: 1,
        status: "ACTIVE",
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async recordMovementAtomic(
    input: RecordMovementCommand,
  ): Promise<{ stockItem: StockItem; movementId: string; duplicate: boolean }> {
    const transaction = await this.database.transaction();
    try {
      const duplicate = await transaction.query<{
        movement_id: string;
        stock_item: StockRow;
      }>(
        `SELECT m.id AS movement_id, s.id, s.family_id, s.product_id, s.current_quantity,
            s.unit, s.reorder_point, s.version, s.status
         FROM stock_movements m
         JOIN stock_items s ON s.id = m.stock_item_id
         WHERE m.family_id = $1 AND m.client_operation_id = $2
         LIMIT 1`,
        [input.familyId, input.clientOperationId],
      );
      const duplicateRow = duplicate.rows[0];
      if (duplicateRow !== undefined) {
        await transaction.commit();
        return {
          stockItem: mapStock(duplicateRow.stock_item),
          movementId: duplicateRow.movement_id,
          duplicate: true,
        };
      }

      const locked = await transaction.query<StockRow>(
        `SELECT id, family_id, product_id, current_quantity, unit, reorder_point, version, status
         FROM stock_items WHERE id = $1 AND family_id = $2 AND status = 'ACTIVE' FOR UPDATE`,
        [input.stockItemId, input.familyId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("Stock item is not visible.");
      const currentQuantity = numberValue(row.current_quantity);
      const nextQuantity = currentQuantity + movementDelta(input);
      if (nextQuantity < 0) throw new Error("Stock quantity cannot become negative.");

      const updated = await transaction.query<StockRow>(
        `UPDATE stock_items
         SET current_quantity = $1, version = version + 1, updated_at = now()
         WHERE id = $2 AND family_id = $3
         RETURNING id, family_id, product_id, current_quantity, unit, reorder_point, version, status`,
        [nextQuantity, input.stockItemId, input.familyId],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) throw new Error("Stock item update returned no row.");
      const movement = await transaction.query<{ id: string }>(
        `INSERT INTO stock_movements
          (family_id, stock_item_id, kind, quantity, unit, source, client_operation_id, actor_id, occurred_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING id`,
        [
          input.familyId,
          input.stockItemId,
          input.kind,
          input.quantity,
          input.unit,
          input.source,
          input.clientOperationId,
          input.actorId,
          input.occurredAt,
          JSON.stringify({ traceId: input.traceId }),
        ],
      );
      const movementId = movement.rows[0]?.id;
      if (movementId === undefined) throw new Error("Movement insert returned no id.");
      await transaction.commit();
      return { stockItem: mapStock(updatedRow), movementId, duplicate: false };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Backs `GET /api/v1/inventory/stock-items?familyId=...` (InventoryController.listStockItems).
   * Read-only, so it uses the same transaction/commit shape as the writes above purely for
   * consistency with this repository's existing style, not because it needs write locking.
   */
  public async listByFamily(familyId: string): Promise<StockItem[]> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<StockRow>(
        `SELECT id, family_id, product_id, current_quantity, unit, reorder_point, version, status
         FROM stock_items
         WHERE family_id = $1 AND status = 'ACTIVE'
         ORDER BY updated_at DESC`,
        [familyId],
      );
      await transaction.commit();
      return result.rows.map(mapStock);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function movementDelta(input: RecordMovementCommand): number {
  if (input.kind === "RECEIPT") return input.quantity;
  if (input.kind === "CONSUMPTION" || input.kind === "WASTE") return -input.quantity;
  return 0;
}

function mapStock(row: StockRow): StockItem {
  return {
    id: row.id,
    familyId: row.family_id,
    productId: row.product_id,
    quantity: numberValue(row.current_quantity),
    unit: row.unit,
    reorderPoint: row.reorder_point === null ? undefined : numberValue(row.reorder_point),
    version: row.version,
    status: row.status,
  };
}

function numberValue(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Database returned an invalid numeric value.");
  return parsed;
}

/**
 * Read-only lookup backing InventoryController's If-Match/version-conflict
 * check and family-scoping before a movement is recorded. Deliberately
 * narrow (id -> familyId/version only) rather than reusing StockItem, since
 * the controller boundary only needs enough to authorize and detect stale
 * writes, not the full stock item shape.
 */
export class PostgresInventoryReader {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async getStockItem(
    stockItemId: string,
  ): Promise<{ familyId: string; version: number } | undefined> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<{ family_id: string; version: number }>(
        `SELECT family_id, version FROM stock_items WHERE id = $1 AND status = 'ACTIVE'`,
        [stockItemId],
      );
      await transaction.commit();
      const row = result.rows[0];
      return row === undefined ? undefined : { familyId: row.family_id, version: row.version };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
