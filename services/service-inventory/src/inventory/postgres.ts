import type {
  CreateStockItemCommand,
  InventoryRepository,
  ListStockItemsQuery,
  PagedStockItems,
  RecordMovementCommand,
  StockItem,
} from "./service.js";
import { InventoryConflictError } from  "./service.js";
import { normalizeListQuery } from "./service.js";
import type { ShelfLifeEstimator, CoreStorageKind as StorageKind } from "./shelf-life-client.js";
import { normalizeStorageKind } from "./shelf-life-client.js";

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
  earliest_expiry_at?: string | null;
  batches?: unknown;
}

/**
 * Shared "active lots" projection for a stock item, reused by getById/listByFamily/
 * listByFamilyAndStatus (see migration 0017_pantry-optimization-and-new-features.sql). Each lot
 * now carries its own location (stock_lots.location_id) since a single stock item can have lots
 * spread across several places (e.g. some units in the fridge, some in the freezer). Only lots
 * with remaining quantity are surfaced -- a fully consumed lot has nothing left to show and would
 * otherwise clutter the pantry card with a stale "0 pz" batch.
 */
const BATCHES_SUBQUERY = `(SELECT jsonb_agg(
                    jsonb_build_object(
                      'quantity', sl.quantity_snapshot,
                      'expiryDate', sl.expires_at,
                      'locationId', sl.location_id,
                      'location', sll.name
                    ) ORDER BY sl.expires_at NULLS LAST
                  )
            FROM stock_lots sl
            LEFT JOIN locations sll ON sll.id = sl.location_id
            WHERE sl.stock_item_id = s.id AND COALESCE(sl.quantity_snapshot, 0) > 0) AS batches`;

export class PostgresInventoryRepository implements InventoryRepository {
  private readonly database: SqlTransactionFactory;
  private readonly shelfLife: ShelfLifeEstimator | undefined;

  /**
   * `shelfLife` is optional so this repository keeps working unconfigured (e.g. in existing
   * tests that construct it with just a database double): without it, createStockItemAtomic
   * falls back to today's behaviour exactly -- no expiresAt means no stock_lots row at all.
   */
  public constructor(database: SqlTransactionFactory, shelfLife?: ShelfLifeEstimator) {
    this.database = database;
    this.shelfLife = shelfLife;
  }

  public async getById(stockItemId: string): Promise<StockItem | undefined> {
    // Deliberately matches ACTIVE and DEPLETED (not ARCHIVED): a depleted stock item stays
    // individually addressable so it can be restocked (see recordMovementAtomic) and shown in
    // the shopping list's "prodotti finiti" picker. See migration 0015_stock-depletion.sql.
    const tx = await this.database.transaction();
    try {
      const r = await tx.query<StockRow>(
        `SELECT s.id, s.family_id, s.product_id, s.current_quantity, s.unit, s.reorder_point,
            s.version, s.status, s.earliest_expiry_at,
            p.canonical_name AS product_name, b.name AS brand, p.category, p.provenance_quality,
            p.calories_per_100, p.protein_per_100, p.carbs_per_100, p.fat_per_100, p.fiber_per_100,
            l.name AS location_name,
            ${BATCHES_SUBQUERY}
         FROM stock_items s
         JOIN products p ON p.id = s.product_id
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN locations l ON l.id = s.location_id
         WHERE s.id = $1 AND s.status IN ('ACTIVE', 'DEPLETED')`,
        [stockItemId],
      );
      await tx.commit();
      const row = r.rows[0];
      return row === undefined ? undefined : mapStock(row);
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  public async listMovements(stockItemId: string, familyId: string): Promise<readonly Record<string, unknown>[]> {
    const tx=await this.database.transaction(); try { const r=await tx.query(`SELECT id, stock_item_id AS "stockItemId", kind, quantity, unit, source, actor_id AS "actorId", occurred_at AS "occurredAt", created_at AS "createdAt", metadata FROM stock_movements WHERE stock_item_id=$1 AND family_id=$2 ORDER BY occurred_at DESC, created_at DESC`,[stockItemId,familyId]); await tx.commit(); return r.rows; } catch(e){await tx.rollback();throw e;}
  }

  /**
   * Finds-or-creates: since migration 0017_pantry-optimization-and-new-features.sql, the semantic
   * key is (family_id, product_id) ONLY -- package and location no longer split a product into
   * several stock_items rows (see stock_items_active_product_idx). Position is now tracked per
   * LOT (stock_lots.location_id), so the very same stock_item can end up with lots in the fridge
   * AND in the freezer. Scanning the same barcode twice (or the frontend calling this twice for
   * the same product, from any location) merges the new quantity onto the existing row -- and
   * reactivates it if it had been DEPLETED -- instead of inserting a duplicate. Each call still
   * adds its OWN stock_lots row with its own expiry and its own location, so a merged item can
   * show "3 pz in scadenza il 2 (frigo), 2 pz in scadenza il 9 (freezer)" (see mapStock's
   * `batches`) instead of collapsing everything into one date/place.
   * See infra/postgres/migrations/0016_stock-dedup.sql and 0017_pantry-optimization-and-new-features.sql
   * for the matching schema-level guarantees.
   */
  public async createStockItemAtomic(
    input: CreateStockItemCommand & { id: string },
  ): Promise<StockItem> {
    const transaction = await this.database.transaction();
    try {
      let locationId = input.locationId ?? null;
      let storageKind: StorageKind = normalizeStorageKind(input.location);
      if (!locationId && input.location) {
        const normalizedLocation = storageKind;
        // Upsert by (family_id, lower(name)) -- see 0016_stock-dedup.sql -- so resolving the same
        // free-text location twice ("frigo") always lands on the SAME row. DO UPDATE (a no-op
        // self-assignment) rather than DO NOTHING purely so RETURNING always yields a row.
        const locationResult = await transaction.query<{ id: string }>(
          `INSERT INTO locations (family_id, name, kind)
           VALUES ($1, $2, $3)
           ON CONFLICT (family_id, lower(name)) WHERE status = 'ACTIVE'
             DO UPDATE SET name = locations.name
           RETURNING id`,
          [input.familyId, input.location, normalizedLocation],
        );
        locationId = locationResult.rows[0]?.id ?? null;
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

      // Same semantic key as stock_items_active_product_idx (0017): family_id + product_id ONLY.
      // Package/location are deliberately NOT part of the match anymore -- they used to split the
      // same product into several stock_items rows; now they only describe individual lots.
      // Matching ACTIVE *and* DEPLETED so a re-scan after a product ran out reactivates that SAME
      // row (see 0015_stock-depletion.sql) instead of creating a fresh one next to an orphan.
      // FOR UPDATE serializes concurrent calls for this exact key once the row exists.
      const existing = await transaction.query<StockRow>(
        `SELECT id, family_id, product_id, current_quantity, unit, reorder_point, version, status
         FROM stock_items
         WHERE family_id = $1 AND product_id = $2
           AND status IN ('ACTIVE', 'DEPLETED')
         FOR UPDATE`,
        [input.familyId, input.productId],
      );
      const existingRow = existing.rows[0];

      let stockItemId: string;
      let resultRow: StockRow;
      if (existingRow !== undefined) {
        // Merge onto the existing row: add this receipt's quantity, reactivate if depleted. An
        // explicit reorderPoint on this call replaces the stored one; otherwise it's left as-is.
        // stock_items.location_id is left untouched here: it is a deprecated "last known location"
        // field for pre-0017 clients only (see StockItem.location) -- the real, current locations
        // now live per-lot on stock_lots and are populated below regardless of this branch.
        const mergedQuantity = numberValue(existingRow.current_quantity) + input.quantity;
        const updated = await transaction.query<StockRow>(
          `UPDATE stock_items
           SET current_quantity = $1, status = 'ACTIVE', version = version + 1, updated_at = now(),
               reorder_point = COALESCE($2, reorder_point)
           WHERE id = $3
           RETURNING id, family_id, product_id, current_quantity, unit, reorder_point, version, status`,
          [mergedQuantity, input.reorderPoint ?? null, existingRow.id],
        );
        resultRow = updated.rows[0]!;
        stockItemId = existingRow.id;
      } else {
        // No existing row found: insert one. ON CONFLICT targets stock_items_active_product_idx
        // (family_id, product_id) WHERE status = 'ACTIVE' -- the new 0017 semantic key -- as a
        // belt-and-braces safety net for a genuine race between two concurrent "first scan"
        // requests that both passed the SELECT above before either committed. package_id/
        // location_id are still written once, for backward-compatible display only (see
        // StockItem.location); they play no role in identity anymore.
        const inserted = await transaction.query<StockRow>(
          `INSERT INTO stock_items
            (id, family_id, product_id, package_id, location_id, current_quantity, unit, reorder_point, status, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', 1)
           ON CONFLICT (family_id, product_id) WHERE status = 'ACTIVE'
             DO UPDATE SET
               current_quantity = stock_items.current_quantity + excluded.current_quantity,
               reorder_point = COALESCE(excluded.reorder_point, stock_items.reorder_point),
               version = stock_items.version + 1,
               updated_at = now()
           RETURNING id, family_id, product_id, current_quantity, unit, reorder_point, version, status`,
          [
            input.id, input.familyId, input.productId, input.packageId ?? null,
            locationId, input.quantity, input.unit, input.reorderPoint ?? null,
          ],
        );
        resultRow = inserted.rows[0]!;
        stockItemId = resultRow.id;
      }

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
      // Every call adds its OWN lot (this receipt's quantity, its own expiry, its own location),
      // even when merging into an existing item -- see the method doc comment above for why. Unlike
      // pre-0017 behaviour, a lot is ALWAYS created even when there is no known/estimated expiry
      // (expires_at NULL, expiry_source 'MANUAL'): stock_lots is now the source of truth that the
      // stock_items.total_quantity/earliest_expiry_at trigger aggregates from (see the migration),
      // so an item can no longer hold quantity that isn't backed by at least one lot.
      await transaction.query(
        `INSERT INTO stock_lots (stock_item_id, location_id, received_at, expires_at, quantity_snapshot, expiry_source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [stockItemId, locationId, new Date(), expiresAt ?? null, input.quantity, expiresAt ? expirySource : "MANUAL"],
      );
      await transaction.commit();
      return mapStock(resultRow);
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
      if (row.version !== input.expectedVersion) {
        throw new InventoryConflictError("Stock item version is stale.");
      }
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
   * A single round-trip covers pagination, trigram/ILIKE name search, per-lot location
   * filtering and sorting -- see migration 0017_pantry-optimization-and-new-features.sql for the
   * supporting indexes (products_canonical_name_trgm_idx, stock_items_family_status_expiry_idx).
   * `count(*) OVER()` gives the total matching row count in the same query instead of a second
   * round-trip, at the cost of that count being repeated on every row (negligible for the page
   * sizes this endpoint uses, capped at MAX_STOCK_ITEMS_PAGE_SIZE).
   */
  public async listByFamily(familyId: string, query?: ListStockItemsQuery): Promise<PagedStockItems> {
    const { page, pageSize, sortBy, sortDir, search, locationId } = normalizeListQuery(query);
    const offset = (page - 1) * pageSize;
    const orderBy = orderByClause(sortBy, sortDir);
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<StockRow & { total_count: string | number }>(
        `SELECT
          s.id, s.family_id, s.product_id, s.current_quantity, s.unit,
          s.reorder_point, s.version, s.status, s.earliest_expiry_at,
          p.canonical_name AS product_name,
          b.name AS brand,
          p.category,
          p.provenance_quality,
          p.calories_per_100, p.protein_per_100, p.carbs_per_100,
          p.fat_per_100, p.fiber_per_100,
          l.name AS location_name,
          ${BATCHES_SUBQUERY},
          count(*) OVER() AS total_count
        FROM stock_items s
        JOIN products p ON p.id = s.product_id
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN locations l ON l.id = s.location_id
        WHERE s.family_id = $1 AND s.status = 'ACTIVE'
          AND ($2::text IS NULL OR p.canonical_name ILIKE '%' || $2 || '%' OR similarity(p.canonical_name, $2) > 0.2)
          AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM stock_lots sl
                WHERE sl.stock_item_id = s.id AND sl.location_id = $3 AND COALESCE(sl.quantity_snapshot, 0) > 0
              ))
        ${orderBy}
        LIMIT $4 OFFSET $5`,
        [familyId, search ?? null, locationId ?? null, pageSize, offset],
      );
      await transaction.commit();
      const total = result.rows[0] === undefined ? 0 : numberValue(result.rows[0].total_count);
      return { items: result.rows.map(mapStock), page, pageSize, total };
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
          s.reorder_point, s.version, s.status, s.earliest_expiry_at,
          p.canonical_name AS product_name,
          b.name AS brand,
          p.category,
          p.provenance_quality,
          p.calories_per_100, p.protein_per_100, p.carbs_per_100,
          p.fat_per_100, p.fiber_per_100,
          l.name AS location_name,
          ${BATCHES_SUBQUERY}
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

/**
 * Builds a whitelisted ORDER BY clause. sortBy/sortDir are already narrowed to a fixed union by
 * normalizeListQuery (service.ts), so direct interpolation here carries no injection risk -- the
 * only strings that can reach this function are the literal enum members below.
 */
function orderByClause(sortBy: "updatedAt" | "expiry" | "name", sortDir: "ASC" | "DESC"): string {
  if (sortBy === "expiry") {
    return sortDir === "DESC"
      ? "ORDER BY s.earliest_expiry_at DESC NULLS LAST, s.updated_at DESC"
      : "ORDER BY s.earliest_expiry_at ASC NULLS LAST, s.updated_at DESC";
  }
  if (sortBy === "name") {
    return sortDir === "DESC" ? "ORDER BY p.canonical_name DESC" : "ORDER BY p.canonical_name ASC";
  }
  return sortDir === "DESC" ? "ORDER BY s.updated_at ASC" : "ORDER BY s.updated_at DESC";
}

function movementDelta(input: RecordMovementCommand): number {
  if (input.kind === "RECEIPT") return input.quantity;
  if (input.kind === "CONSUMPTION" || input.kind === "WASTE") return -input.quantity;
  return 0;
}

function mapStock(row: StockRow): StockItem {
  const batches = Array.isArray(row.batches)
    ? row.batches
        .filter(
          (value): value is { quantity?: unknown; expiryDate?: unknown; locationId?: unknown; location?: unknown } =>
            typeof value === "object" && value !== null,
        )
        .map((value) => ({
          quantity: numberValue(
            typeof value.quantity === "string" || typeof value.quantity === "number"
              ? value.quantity
              : 0,
          ),
          ...(typeof value.expiryDate === "string" ? { expiryDate: value.expiryDate } : {}),
          ...(typeof value.locationId === "string" ? { locationId: value.locationId } : {}),
          ...(typeof value.location === "string" ? { location: value.location } : {}),
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
    ...(row.earliest_expiry_at ? { earliestExpiryAt: row.earliest_expiry_at } : {}),
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
