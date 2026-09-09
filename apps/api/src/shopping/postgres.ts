import type {
  AddShoppingItemCommand,
  CreateShoppingListCommand,
  ShoppingItem,
  ShoppingList,
  ShoppingRepository,
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
