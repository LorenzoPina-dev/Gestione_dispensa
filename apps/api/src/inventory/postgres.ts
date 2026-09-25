import type {
  CreateStockItemCommand,
  InventoryRepository,
  RecordMovementCommand,
  StockItem,
} from "./service.js";
import type { ShelfLifeEstimationService, StorageKind } from "../shelf-life/service.js";
import { normalizeStorageKind } from "../shelf-life/service.js";

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
  status: "ACTIVE" | "DEPLETED";
  product_name?: string | null;
  brand?: string | null;
  category?: string | null;
  provenance_quality?: StockItem["provenance"];
  calories_per_100?: string | number | null;
  protein_per_100?: string | number | null;
  carbs_per_100?: string | number | null;
  fat_per_100?: string | number | null;
  fiber_per_100?: string | number | null;
  location_name?: string | null;
  batches?: unknown;
}

export class PostgresInventoryRepository implements InventoryRepository {
  private readonly database: SqlTransactionFactory;
  private readonly shelfLife: ShelfLifeEstimationService | undefined;

  /**
   * `shelfLife` is optional so this repository keeps working unconfigured (e.g. in existing
   * tests that construct it with just a database double): without it, createStockItemAtomic
   * falls back to today's behaviour exactly -- no expiresAt means no stock_lots row at all.
   */
  public constructor(database: SqlTransactionFactory, shelfLife?: ShelfLifeEstimationService) {
    this.database = database;
    this.shelfLife = shelfLife;
  }

  public async getById(stockItemId: string): Promise<StockItem | undefined> {
    // Deliberately matches ACTIVE and DEPLETED (not ARCHIVED): a depleted stock item stays
    // individually addressable so it can be restocked (see recordMovementAtomic) and shown in
    // the shopping list's "prodotti finiti" picker. See migration 0015_stock-depletion.sql.
    const tx=await this.database.transaction(); try { const r=await tx.query<StockRow>(`SELECT s.id, s.family_id, s.product_id, s.current_quantity, s.unit, s.reorder_point, s.version, s.status, p.canonical_name AS product_name, b.name AS brand, p.category, p.provenance_quality, p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100, l.name AS location_name, (SELECT jsonb_agg(jsonb_build_object('quantity', sl.quantity_snapshot, 'expiryDate', sl.expires_at) ORDER BY sl.expires_at NULLS LAST) FROM stock_lots sl WHERE sl.stock_item_id = s.id) AS batches FROM stock_items s JOIN products p ON p.id=s.product_id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN locations l ON l.id=s.location_id WHERE s.id=$1 AND s.status IN ('ACTIVE','DEPLETED')`,[stockItemId]); await tx.commit(); const row=r.rows[0]; return row===undefined?undefined:mapStock(row); } catch(e){await tx.rollback();throw e;}
  }

  public async listMovements(stockItemId: string, familyId: string): Promise<readonly Record<string, unknown>[]> {
    const tx=await this.database.transaction(); try { const r=await tx.query(`SELECT id, stock_item_id AS "stockItemId", kind, quantity, unit, source, actor_id AS "actorId", occurred_at AS "occurredAt", created_at AS "createdAt", metadata FROM stock_movements WHERE stock_item_id=$1 AND family_id=$2 ORDER BY occurred_at DESC, created_at DESC`,[stockItemId,familyId]); await tx.commit(); return r.rows; } catch(e){await tx.rollback();throw e;}
  }

  public async createStockItemAtomic(
    input: CreateStockItemCommand & { id: string },
  ): Promise<StockItem> {
    const transaction = await this.database.transaction();
    try {
      let locationId = input.locationId ?? null;
      let storageKind: StorageKind = normalizeStorageKind(input.location);
      if (!locationId && input.location) {
        const normalizedLocation = storageKind;
        const locationResult = await transaction.query<{ id: string }>(
          `INSERT INTO locations (family_id, name, kind)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [input.familyId, input.location, normalizedLocation],
        );
        locationId = locationResult.rows[0]?.id ?? null;
        if (!locationId) {
          const existing = await transaction.query<{ id: string }>(
            `SELECT id FROM locations WHERE family_id=$1 AND name=$2 AND status='ACTIVE' LIMIT 1`,
            [input.familyId, input.location],
          );
          locationId = existing.rows[0]?.id ?? null;
        }
      } else if (locationId) {
        // locationId was passed directly (no free-text location): resolve its stored kind so the
        // shelf-life estimate below uses the location the caller actually picked, not a guess.
        const kindResult = await transaction.query<{ kind: string }>(
          `SELECT kind FROM locations WHERE id = $1`,
          [locationId],
        );
        const kind = kindResult.rows[0]?.kind;
        if (kind) storageKind = normalizeStorageKind(kind);
      }
      await transaction.query(
        `INSERT INTO stock_items
          (id, family_id, product_id, package_id, location_id, current_quantity, unit, reorder_point, status, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', 1)`,
        [
          input.id, input.familyId, input.productId, input.packageId ?? null,
          locationId, input.quantity, input.unit, input.reorderPoint ?? null,
        ],
      );
      let expiresAt = input.expiresAt;
      let expirySource: "MANUAL" | "ESTIMATED" = "MANUAL";
      if (!expiresAt && this.shelfLife) {
        // No explicit expiry: ask ShelfLifeEstimationService, using the product's catalog
        // category and the resolved storage kind (see shelf-life/service.ts). A product with no
        // category, or a category with no rule, falls back to the DEFAULT_CATEGORY rule for this
        // storage kind rather than leaving the lot untracked.
        const productResult = await transaction.query<{ category: string | null }>(
          `SELECT category FROM products WHERE id = $1`,
          [input.productId],
        );
        const category = productResult.rows[0]?.category ?? undefined;
        const estimate = await this.shelfLife.estimate({
          category,
          storageKind,
          receivedAt: new Date(),
        });
        if (estimate.expiresAt) {
          expiresAt = estimate.expiresAt;
          expirySource = "ESTIMATED";
        }
      }
      if (expiresAt) {
        await transaction.query(
          `INSERT INTO stock_lots (stock_item_id, received_at, expires_at, quantity_snapshot, expiry_source)
           VALUES ($1, $2, $3, $4, $5)`,
          [input.id, new Date(), expiresAt, input.quantity, expirySource],
        );
      }
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

      // Matches ACTIVE and DEPLETED: a RECEIPT on an already-depleted item must be able to find
      // and reactivate that SAME row (see nextStatus below) instead of failing with "not
      // visible". ARCHIVED items stay excluded -- those are soft-deleted, not restockable.
      const locked = await transaction.query<StockRow>(
        `SELECT id, family_id, product_id, current_quantity, unit, reorder_point, version, status
         FROM stock_items WHERE id = $1 AND family_id = $2 AND status IN ('ACTIVE', 'DEPLETED') FOR UPDATE`,
        [input.stockItemId, input.familyId],
      );
      const row = locked.rows[0];
      if (row === undefined) throw new Error("Stock item is not visible.");
      const currentQuantity = numberValue(row.current_quantity);
      const nextQuantity = currentQuantity + movementDelta(input);
      if (nextQuantity < 0) throw new Error("Stock quantity cannot become negative.");
      // A CONSUMPTION/WASTE movement that empties the item marks it DEPLETED, so it disappears
      // from the pantry view (listByFamily filters status = 'ACTIVE') without deleting any
      // history; a RECEIPT that brings a depleted item back above zero reactivates the SAME row.
      // See infra/postgres/migrations/0015_stock-depletion.sql.
      const nextStatus: StockRow["status"] = nextQuantity > 0 ? "ACTIVE" : "DEPLETED";

      const updated = await transaction.query<StockRow>(
        `UPDATE stock_items
         SET current_quantity = $1, status = $2, version = version + 1, updated_at = now()
         WHERE id = $3 AND family_id = $4
         RETURNING id, family_id, product_id, current_quantity, unit, reorder_point, version, status`,
        [nextQuantity, nextStatus, input.stockItemId, input.familyId],
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

      if (input.kind === "RECEIPT") {
        await transaction.query(
          `INSERT INTO stock_lots (stock_item_id, received_at, quantity_snapshot)
           VALUES ($1, $2, $3)`,
          [input.stockItemId, input.occurredAt, input.quantity],
        );
      } else if (input.kind === "CONSUMPTION" || input.kind === "WASTE") {
        let remaining = input.quantity;
        const lots = await transaction.query<{ id: string; quantity_snapshot: string | number }>(
          `SELECT id, quantity_snapshot FROM stock_lots
           WHERE stock_item_id=$1 AND quantity_snapshot > 0
           ORDER BY expires_at NULLS LAST, received_at ASC, id
           FOR UPDATE`,
          [input.stockItemId],
        );
        for (const lot of lots.rows) {
          if (remaining <= 0) break;
          const available = numberValue(lot.quantity_snapshot);
          const consumed = Math.min(available, remaining);
          await transaction.query(
            `UPDATE stock_lots SET quantity_snapshot = quantity_snapshot - $2 WHERE id=$1`,
            [lot.id, consumed],
          );
          remaining -= consumed;
        }
      }
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
        `SELECT
          s.id, s.family_id, s.product_id, s.current_quantity, s.unit,
          s.reorder_point, s.version, s.status,
          p.canonical_name AS product_name,
          b.name AS brand,
          p.category,
          p.provenance_quality,
          p.calories_per_100, p.protein_per_100, p.carbs_per_100,
          p.fat_per_100, p.fiber_per_100,
          l.name AS location_name,
          (SELECT jsonb_agg(
                    jsonb_build_object(
                      'quantity', sl.quantity_snapshot,
                      'expiryDate', sl.expires_at
                    ) ORDER BY sl.expires_at NULLS LAST
                  )
            FROM stock_lots sl
            WHERE sl.stock_item_id = s.id) AS batches
        FROM stock_items s
        JOIN products p ON p.id = s.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN locations l ON l.id = s.location_id
        WHERE s.family_id = $1 AND s.status = 'ACTIVE'
        ORDER BY s.updated_at DESC`,
        [familyId],
      );
      await transaction.commit();
      return result.rows.map(mapStock);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Same shape as listByFamily but for an explicit status -- used with 'DEPLETED' to back the
   * shopping list's "prodotti finiti" picker (InventoryService.listDepletedStockItems).
   */
  public async listByFamilyAndStatus(
    familyId: string,
    status: "ACTIVE" | "DEPLETED",
  ): Promise<StockItem[]> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<StockRow>(
        `SELECT
          s.id, s.family_id, s.product_id, s.current_quantity, s.unit,
          s.reorder_point, s.version, s.status,
          p.canonical_name AS product_name,
          b.name AS brand,
          p.category,
          p.provenance_quality,
          p.calories_per_100, p.protein_per_100, p.carbs_per_100,
          p.fat_per_100, p.fiber_per_100,
          l.name AS location_name,
          (SELECT jsonb_agg(
                    jsonb_build_object(
                      'quantity', sl.quantity_snapshot,
                      'expiryDate', sl.expires_at
                    ) ORDER BY sl.expires_at NULLS LAST
                  )
            FROM stock_lots sl
            WHERE sl.stock_item_id = s.id) AS batches
        FROM stock_items s
        JOIN products p ON p.id = s.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN locations l ON l.id = s.location_id
        WHERE s.family_id = $1 AND s.status = $2
        ORDER BY s.updated_at DESC`,
        [familyId, status],
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
  const batches = Array.isArray(row.batches)
    ? row.batches
        .filter((value): value is { quantity?: unknown; expiryDate?: unknown } => typeof value === "object" && value !== null)
        .map((value) => ({
          quantity: numberValue(
            typeof value.quantity === "string" || typeof value.quantity === "number"
              ? value.quantity
              : 0,
          ),
          ...(typeof value.expiryDate === "string" ? { expiryDate: value.expiryDate } : {}),
        }))
    : undefined;
  return {
    id: row.id,
    familyId: row.family_id,
    productId: row.product_id,
    quantity: numberValue(row.current_quantity),
    unit: row.unit,
    reorderPoint: row.reorder_point === null ? undefined : numberValue(row.reorder_point),
    version: row.version,
    status: row.status,
    ...(row.product_name ? { productName: row.product_name } : {}),
    ...(row.brand ? { brand: row.brand } : {}),
    ...(row.category ? { category: row.category } : {}),
    ...(row.provenance_quality ? { provenance: row.provenance_quality } : {}),
    ...(row.calories_per_100 != null ? { calories: numberValue(row.calories_per_100) } : {}),
    ...(row.protein_per_100 != null ? { protein: numberValue(row.protein_per_100) } : {}),
    ...(row.carbs_per_100 != null ? { carbs: numberValue(row.carbs_per_100) } : {}),
    ...(row.fat_per_100 != null ? { fat: numberValue(row.fat_per_100) } : {}),
    ...(row.fiber_per_100 != null ? { fiber: numberValue(row.fiber_per_100) } : {}),
    ...(row.location_name ? { location: row.location_name } : {}),
    ...(batches && batches.length ? { batches } : {}),
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
        // Matches ACTIVE and DEPLETED so InventoryController's If-Match check still finds a
        // depleted item (needed for the RECEIPT that restocks it) -- only ARCHIVED is excluded.
        `SELECT family_id, version FROM stock_items WHERE id = $1 AND status IN ('ACTIVE', 'DEPLETED')`,
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
