import type {
  ActiveShoppingList,
  AddShoppingItemCommand,
  CreateShoppingListCommand,
  ShoppingItem,
  ShoppingItemState,
  ShoppingList,
  ShoppingRepository,
} from "./service.js";
import { ShoppingConflictError } from "./service.js";

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

interface ItemRow {
  id: string;
  list_id: string;
  product_id: string | null;
  display_name: string;
  quantity: string | number;
  unit: ShoppingItem["unit"];
  package_id: string | null;
  state: ShoppingItem["state"];
  source_type: ShoppingItem["sourceType"];
  source_ref: string | null;
  version: number;
}

interface ListRow {
  id: string;
  family_id: string;
  owner_user_id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
}

export class PostgresShoppingRepository implements ShoppingRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async createListAtomic(
    input: CreateShoppingListCommand & { id: string },
  ): Promise<ShoppingList> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `INSERT INTO shopping_lists (id, family_id, name, status, owner_user_id, version)
         VALUES ($1, $2, $3, 'ACTIVE', $4, 1)`,
        [input.id, input.familyId, input.name, input.ownerUserId],
      );
      await transaction.commit();
      return {
        id: input.id,
        familyId: input.familyId,
        ownerUserId: input.ownerUserId,
        name: input.name,
        status: "ACTIVE",
        version: 1,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async addItemAtomic(
    input: AddShoppingItemCommand & { id: string },
  ): Promise<{ item: ShoppingItem; merged: boolean }> {
    const transaction = await this.database.transaction();
    try {
      await transaction.query(
        `SELECT id FROM shopping_lists
         WHERE id = $1 AND family_id = $2 AND status = 'ACTIVE' FOR UPDATE`,
        [input.listId, input.familyId],
      );
      const existing = await transaction.query<ItemRow>(
        `SELECT id, list_id, product_id, display_name, quantity, unit, package_id,
            state, source_type, source_ref, version
         FROM shopping_items
         WHERE list_id = $1 AND product_id IS NOT DISTINCT FROM $2
           AND unit = $3 AND package_id IS NOT DISTINCT FROM $4 AND state <> 'COMPLETED'
         LIMIT 1 FOR UPDATE`,
        [input.listId, input.productId ?? null, input.unit, input.packageId ?? null],
      );
      const current = existing.rows[0];
      if (current !== undefined) {
        await transaction.query(
          `UPDATE shopping_items
           SET quantity = quantity + $1, version = version + 1, updated_at = now()
           WHERE id = $2`,
          [input.quantity, current.id],
        );
        await transaction.query(
          `INSERT INTO shopping_item_sources (item_id, source_type, source_ref, reason_code)
           VALUES ($1, $2, $3, 'MERGED')`,
          [current.id, input.sourceType, input.sourceRef ?? null],
        );
        await transaction.commit();
        return {
          item: {
            ...mapItem(current),
            quantity: numberValue(current.quantity) + input.quantity,
            version: current.version + 1,
          },
          merged: true,
        };
      }
      const inserted = await transaction.query<ItemRow>(
        `INSERT INTO shopping_items
          (id, list_id, product_id, display_name, quantity, unit, package_id, state, source_type, source_ref, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUGGESTED', $8, $9, 1)
         RETURNING id, list_id, product_id, display_name, quantity, unit, package_id,
           state, source_type, source_ref, version`,
        [
          input.id,
          input.listId,
          input.productId ?? null,
          input.displayName,
          input.quantity,
          input.unit,
          input.packageId ?? null,
          input.sourceType,
          input.sourceRef ?? null,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("Shopping item insert returned no row.");
      await transaction.query(
        `INSERT INTO shopping_item_sources (item_id, source_type, source_ref, reason_code)
         VALUES ($1, $2, $3, 'CREATED')`,
        [row.id, input.sourceType, input.sourceRef ?? null],
      );
      await transaction.commit();
      return { item: mapItem(row), merged: false };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Backs `GET /api/v1/shopping/lists/active?familyId=...`. Returns the most recently created
   * ACTIVE list for the family (a family can technically have more than one; the UI works
   * against a single "active" list, matching `Spesa.tsx`'s expectations) with all of its items,
   * or `undefined` when the family has never created a list.
   */
  public async getActiveListByFamily(familyId: string): Promise<ActiveShoppingList | undefined> {
    const transaction = await this.database.transaction();
    try {
      const listResult = await transaction.query<ListRow>(
        `SELECT id, family_id, owner_user_id, name, status, version
         FROM shopping_lists
         WHERE family_id = $1 AND status = 'ACTIVE'
         ORDER BY created_at DESC
         LIMIT 1`,
        [familyId],
      );
      const listRow = listResult.rows[0];
      if (listRow === undefined) {
        await transaction.commit();
        return undefined;
      }
      const itemsResult = await transaction.query<ItemRow>(
        `SELECT id, list_id, product_id, display_name, quantity, unit, package_id,
            state, source_type, source_ref, version
         FROM shopping_items
         WHERE list_id = $1
         ORDER BY created_at ASC`,
        [listRow.id],
      );
      await transaction.commit();
      return { list: mapList(listRow), items: itemsResult.rows.map(mapItem) };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Backs `PATCH /api/v1/shopping/lists/{listId}/items/{itemId}`. Returns `undefined` when the
   * item isn't visible for that family/list; throws `ShoppingConflictError` when the item exists
   * but `expectedVersion` is stale (the classic If-Match optimistic-concurrency pattern used
   * elsewhere in this codebase, e.g. inventory movements).
   */
  public async getListById(familyId: string, listId: string): Promise<ActiveShoppingList | undefined> {
    const transaction = await this.database.transaction();
    try {
      const listResult = await transaction.query<ListRow>(
        `SELECT id, family_id, owner_user_id, name, status, version FROM shopping_lists
         WHERE id = $1 AND family_id = $2 AND status = 'ACTIVE'`, [listId, familyId],
      );
      const listRow = listResult.rows[0];
      if (listRow === undefined) { await transaction.commit(); return undefined; }
      const items = await transaction.query<ItemRow>(
        `SELECT id, list_id, product_id, display_name, quantity, unit, package_id, state, source_type, source_ref, version
         FROM shopping_items WHERE list_id = $1 ORDER BY created_at ASC`, [listId],
      );
      await transaction.commit();
      return { list: mapList(listRow), items: items.rows.map(mapItem) };
    } catch (error) { await transaction.rollback(); throw error; }
  }

  public async archiveListAtomic(input: { familyId: string; listId: string; expectedVersion: number }): Promise<ShoppingList | undefined> {
    const result = await this.database.transaction();
    try {
      const updated = await result.query<ListRow>(
        `UPDATE shopping_lists SET status = 'ARCHIVED', version = version + 1, updated_at = now()
         WHERE id = $1 AND family_id = $2 AND status = 'ACTIVE' AND version = $3
         RETURNING id, family_id, owner_user_id, name, status, version`,
        [input.listId, input.familyId, input.expectedVersion],
      );
      const row = updated.rows[0];
      if (row === undefined) {
        const exists = await result.query<{ id: string; version: number }>(
          `SELECT id, version FROM shopping_lists WHERE id = $1 AND family_id = $2`, [input.listId, input.familyId],
        );
        await result.rollback();
        if (exists.rows[0] !== undefined && exists.rows[0].version !== input.expectedVersion) throw new ShoppingConflictError("Shopping list version is stale.");
        return undefined;
      }
      await result.commit();
      return mapList(row);
    } catch (error) { await result.rollback(); throw error; }
  }

  public async updateItemStateAtomic(input: {
    familyId: string;
    listId: string;
    itemId: string;
    expectedVersion: number;
    state: ShoppingItemState;
  }): Promise<ShoppingItem | undefined> {
    const transaction = await this.database.transaction();
    try {
      const locked = await transaction.query<ItemRow>(
        `SELECT i.id, i.list_id, i.product_id, i.display_name, i.quantity, i.unit, i.package_id,
            i.state, i.source_type, i.source_ref, i.version
         FROM shopping_items i
         JOIN shopping_lists l ON l.id = i.list_id
         WHERE i.id = $1 AND i.list_id = $2 AND l.family_id = $3
         FOR UPDATE`,
        [input.itemId, input.listId, input.familyId],
      );
      const current = locked.rows[0];
      if (current === undefined) {
        await transaction.commit();
        return undefined;
      }
      if (current.version !== input.expectedVersion) {
        await transaction.rollback();
        throw new ShoppingConflictError("Shopping item version is stale.");
      }
      const updated = await transaction.query<ItemRow>(
        `UPDATE shopping_items
         SET state = $1, version = version + 1, updated_at = now()
         WHERE id = $2
         RETURNING id, list_id, product_id, display_name, quantity, unit, package_id,
           state, source_type, source_ref, version`,
        [input.state, input.itemId],
      );
      const row = updated.rows[0];
      if (row === undefined) throw new Error("Shopping item update returned no row.");
      await transaction.commit();
      return mapItem(row);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function mapList(row: ListRow): ShoppingList {
  return {
    id: row.id,
    familyId: row.family_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    status: row.status,
    version: row.version,
  };
}

function mapItem(row: ItemRow): ShoppingItem {
  return {
    id: row.id,
    listId: row.list_id,
    productId: row.product_id ?? undefined,
    displayName: row.display_name,
    quantity: numberValue(row.quantity),
    unit: row.unit,
    packageId: row.package_id ?? undefined,
    state: row.state,
    sourceType: row.source_type,
    sourceRef: row.source_ref ?? undefined,
    version: row.version,
  };
}

function numberValue(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Database returned an invalid numeric value.");
  return parsed;
}
