import type { InventoryUnit } from "../inventory/service.js";
import type { Recipe, RecipeIngredient, RecipeRepository, RecipeStockReader } from "./service.js";

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

interface RecipeRow {
  id: string;
  title: string;
  source: string | null;
  quality: Recipe["quality"];
  servings: number;
  time_minutes: number;
  difficulty: Recipe["difficulty"];
  image: string | null;
  tags: string[];
  calories_per_serving: number | null;
  steps: string[];
}

interface IngredientRow {
  id: string;
  recipe_id: string;
  product_id: string | null;
  display_name: string;
  amount: string | number;
  unit: InventoryUnit;
  allergens: string[];
}

export class PostgresRecipeRepository implements RecipeRepository {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async listActive(): Promise<Recipe[]> {
    const transaction = await this.database.transaction();
    try {
      const recipes = await transaction.query<RecipeRow>(
        `SELECT id, title, source, quality, servings, time_minutes, difficulty, image, tags,
            calories_per_serving, steps
         FROM recipes WHERE status = 'ACTIVE' ORDER BY created_at DESC LIMIT 100`,
      );
      const ingredients = await transaction.query<IngredientRow>(
        `SELECT ri.id, ri.recipe_id, ri.product_id, ri.display_name, ri.amount, ri.unit, ri.allergens
         FROM recipe_ingredients ri
         JOIN recipes r ON r.id = ri.recipe_id
         WHERE r.status = 'ACTIVE'
         ORDER BY ri.recipe_id, ri.position`,
      );
      await transaction.commit();
      const byRecipe = groupIngredients(ingredients.rows);
      return recipes.rows.map((row) => mapRecipe(row, byRecipe.get(row.id) ?? []));
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async getById(id: string): Promise<Recipe | undefined> {
    const transaction = await this.database.transaction();
    try {
      const recipe = await transaction.query<RecipeRow>(
        `SELECT id, title, source, quality, servings, time_minutes, difficulty, image, tags,
            calories_per_serving, steps
         FROM recipes WHERE id = $1 AND status = 'ACTIVE'`,
        [id],
      );
      const row = recipe.rows[0];
      if (row === undefined) {
        await transaction.commit();
        return undefined;
      }
      const ingredients = await transaction.query<IngredientRow>(
        `SELECT id, recipe_id, product_id, display_name, amount, unit, allergens
         FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY position`,
        [id],
      );
      await transaction.commit();
      return mapRecipe(row, ingredients.rows);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

/**
 * Backs the two family-scoped lookups RecipeService needs (which products are in stock, and the
 * specific stock item for a product) without depending on the full InventoryRepository — see the
 * interface doc in recipes/service.ts.
 */
export class PostgresRecipeStockReader implements RecipeStockReader {
  private readonly database: SqlTransactionFactory;

  public constructor(database: SqlTransactionFactory) {
    this.database = database;
  }

  public async listProductIdsInStock(familyId: string): Promise<Set<string>> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<{ product_id: string }>(
        `SELECT DISTINCT product_id FROM stock_items
         WHERE family_id = $1 AND status = 'ACTIVE' AND current_quantity > 0`,
        [familyId],
      );
      await transaction.commit();
      return new Set(result.rows.map((row) => row.product_id));
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  public async findStockItemByProduct(
    familyId: string,
    productId: string,
  ): Promise<{ stockItemId: string; version: number; quantity: number; unit: InventoryUnit } | undefined> {
    const transaction = await this.database.transaction();
    try {
      const result = await transaction.query<{
        id: string;
        version: number;
        current_quantity: string | number;
        unit: InventoryUnit;
      }>(
        `SELECT id, version, current_quantity, unit FROM stock_items
         WHERE family_id = $1 AND product_id = $2 AND status = 'ACTIVE' AND current_quantity > 0
         ORDER BY updated_at DESC LIMIT 1`,
        [familyId, productId],
      );
      await transaction.commit();
      const row = result.rows[0];
      if (row === undefined) return undefined;
      return {
        stockItemId: row.id,
        version: row.version,
        quantity: typeof row.current_quantity === "number" ? row.current_quantity : Number(row.current_quantity),
        unit: row.unit,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}

function groupIngredients(rows: readonly IngredientRow[]): Map<string, IngredientRow[]> {
  const map = new Map<string, IngredientRow[]>();
  for (const row of rows) {
    const list = map.get(row.recipe_id) ?? [];
    list.push(row);
    map.set(row.recipe_id, list);
  }
  return map;
}

function mapRecipe(row: RecipeRow, ingredientRows: readonly IngredientRow[]): Recipe {
  return {
    id: row.id,
    title: row.title,
    source: row.source ?? undefined,
    quality: row.quality,
    servings: row.servings,
    timeMinutes: row.time_minutes,
    difficulty: row.difficulty,
    image: row.image ?? undefined,
    tags: row.tags,
    caloriesPerServing: row.calories_per_serving ?? undefined,
    steps: row.steps,
    ingredients: ingredientRows.map(mapIngredient),
  };
}

function mapIngredient(row: IngredientRow): RecipeIngredient {
  return {
    id: row.id,
    productId: row.product_id ?? undefined,
    displayName: row.display_name,
    amount: typeof row.amount === "number" ? row.amount : Number(row.amount),
    unit: row.unit,
    allergens: row.allergens,
  };
}
