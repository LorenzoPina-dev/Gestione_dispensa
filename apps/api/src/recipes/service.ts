import { InventoryService, type InventoryUnit } from "../inventory/service.js";
import { ShoppingService } from "../shopping/service.js";

export type RecipeQuality = "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";
export type RecipeDifficulty = "Facile" | "Medio" | "Difficile";

export interface RecipeIngredient {
  id: string;
  productId: string | undefined;
  displayName: string;
  amount: number;
  unit: InventoryUnit;
  allergens: string[];
}

export interface Recipe {
  id: string;
  title: string;
  source: string | undefined;
  quality: RecipeQuality;
  servings: number;
  timeMinutes: number;
  difficulty: RecipeDifficulty;
  image: string | undefined;
  tags: string[];
  caloriesPerServing: number | undefined;
  steps: string[];
  ingredients: RecipeIngredient[];
}

export interface RecipeMatch {
  recipe: Recipe;
  score: number;
  matchedIngredientNames: string[];
  missingIngredients: RecipeIngredient[];
}

export interface RecipeRepository {
  listActive(): Promise<Recipe[]>;
  getById(id: string): Promise<Recipe | undefined>;
}

/**
 * Family-scoped lookups the recipe domain needs but that belong conceptually to inventory: which
 * products the family currently has in stock, and the specific stock item (id + version) for a
 * given product so a movement can be recorded against it. Kept as a narrow interface here rather
 * than depending on the full InventoryRepository, the same pattern used for
 * InventoryReader/ShoppingMembershipReader elsewhere in this codebase.
 */
export interface RecipeStockReader {
  listProductIdsInStock(familyId: string): Promise<Set<string>>;
  findStockItemByProduct(
    familyId: string,
    productId: string,
  ): Promise<{ stockItemId: string; version: number; quantity: number; unit: InventoryUnit } | undefined>;
}

export class RecipeValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";

  public constructor(issues: readonly string[]) {
    super(`Recipe query is invalid: ${issues.join("; ")}`);
    this.name = "RecipeValidationError";
  }
}

export class RecipeNotFoundError extends Error {
  public readonly code = "NOT_FOUND_OR_NOT_VISIBLE";

  public constructor() {
    super("Recipe is not visible.");
    this.name = "RecipeNotFoundError";
  }
}

export class RecipeService {
  private readonly recipes: RecipeRepository;
  private readonly stock: RecipeStockReader;
  private readonly shopping: ShoppingService;
  private readonly inventory: InventoryService;

  public constructor(
    recipes: RecipeRepository,
    stock: RecipeStockReader,
    shopping: ShoppingService,
    inventory: InventoryService,
  ) {
    this.recipes = recipes;
    this.stock = stock;
    this.shopping = shopping;
    this.inventory = inventory;
  }

  /** Backs `GET /api/v1/recipes/suggestions?familyId=...`, sorted by best match first. */
  public async listSuggestions(familyId: string): Promise<RecipeMatch[]> {
    if (!familyId.trim()) throw new RecipeValidationError(["familyId is required"]);
    const [recipes, inStock] = await Promise.all([
      this.recipes.listActive(),
      this.stock.listProductIdsInStock(familyId),
    ]);
    return recipes
      .map((recipe) => matchRecipe(recipe, inStock))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Adds every ingredient the family doesn't have in stock to their active shopping list
   * (auto-creating one if they don't have one yet, same as `useShoppingList`'s frontend
   * behaviour). Backs `POST /api/v1/recipes/{id}/add-missing`.
   */
  public async addMissingIngredients(input: {
    familyId: string;
    recipeId: string;
    actorId: string;
    traceId: string;
  }): Promise<{ itemIds: string[] }> {
    const recipe = await this.recipes.getById(input.recipeId);
    if (recipe === undefined) throw new RecipeNotFoundError();
    const inStock = await this.stock.listProductIdsInStock(input.familyId);
    const missing = recipe.ingredients.filter(
      (ingredient) => ingredient.productId === undefined || !inStock.has(ingredient.productId),
    );
    if (missing.length === 0) return { itemIds: [] };

    let list = await this.shopping.getActiveList(input.familyId);
    if (list === undefined) {
      const created = await this.shopping.createList({
        familyId: input.familyId,
        ownerUserId: input.actorId,
        name: "Spesa settimanale",
        traceId: input.traceId,
      });
      list = { list: created, items: [] };
    }

    const itemIds: string[] = [];
    for (const ingredient of missing) {
      const result = await this.shopping.addItem({
        familyId: input.familyId,
        listId: list.list.id,
        ...(ingredient.productId !== undefined ? { productId: ingredient.productId } : {}),
        displayName: ingredient.displayName,
        quantity: ingredient.amount,
        unit: ingredient.unit,
        sourceType: "RECIPE",
        sourceRef: recipe.id,
        traceId: input.traceId,
      });
      itemIds.push(result.item.id);
    }
    return { itemIds };
  }

  /**
   * Records a CONSUMPTION movement for every ingredient the family has in stock, scaled to the
   * requested serving count (`ingredient.amount * servings / recipe.servings`). Ingredients not
   * in stock are silently skipped (the person would have had to add them to the pantry first —
   * this mirrors `addMissingIngredients`'s matching, not a separate validation). Backs
   * `POST /api/v1/recipes/{id}/cook`.
   */
  public async cook(input: {
    familyId: string;
    recipeId: string;
    servings: number;
    actorId: string;
    traceId: string;
  }): Promise<{ movementIds: string[] }> {
    if (!Number.isFinite(input.servings) || input.servings <= 0) {
      throw new RecipeValidationError(["servings must be positive"]);
    }
    const recipe = await this.recipes.getById(input.recipeId);
    if (recipe === undefined) throw new RecipeNotFoundError();
    const scale = input.servings / recipe.servings;

    const movementIds: string[] = [];
    for (const ingredient of recipe.ingredients) {
      if (ingredient.productId === undefined) continue;
      const stockItem = await this.stock.findStockItemByProduct(input.familyId, ingredient.productId);
      if (stockItem === undefined) continue;
      const quantity = Math.min(ingredient.amount * scale, stockItem.quantity);
      if (quantity <= 0) continue;
      const result = await this.inventory.recordMovement({
        familyId: input.familyId,
        stockItemId: stockItem.stockItemId,
        kind: "CONSUMPTION",
        quantity,
        unit: stockItem.unit,
        source: `recipe:${recipe.id}`,
        clientOperationId: `${recipe.id}:${stockItem.stockItemId}:${input.traceId}`,
        actorId: input.actorId,
        occurredAt: new Date(),
        traceId: input.traceId,
      });
      movementIds.push(result.movementId);
    }
    return { movementIds };
  }
}

function matchRecipe(recipe: Recipe, inStock: Set<string>): RecipeMatch {
  const matched: string[] = [];
  const missing: RecipeIngredient[] = [];
  for (const ingredient of recipe.ingredients) {
    if (ingredient.productId !== undefined && inStock.has(ingredient.productId)) {
      matched.push(ingredient.displayName);
    } else {
      missing.push(ingredient);
    }
  }
  const total = recipe.ingredients.length || 1;
  return { recipe, score: matched.length / total, matchedIngredientNames: matched, missingIngredients: missing };
}
