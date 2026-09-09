export type DataQuality = "VERIFIED" | "IMPORTED" | "ESTIMATED" | "UNKNOWN";

export interface RecipeIngredient {
  readonly name: string;
  readonly productId?: string;
  readonly allergens: readonly string[];
}

export interface RecipeDefinition {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly quality: DataQuality;
  readonly servings: number;
  readonly ingredients: readonly RecipeIngredient[];
}

export interface RecipeRankingInput {
  readonly availableIngredients: readonly string[];
  readonly excludedAllergens: readonly string[];
}

export interface RankedRecipe {
  readonly recipe: RecipeDefinition;
  readonly matchedIngredients: readonly string[];
  readonly missingIngredients: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly score: number;
}

export function rankRecipes(
  recipes: readonly RecipeDefinition[],
  input: RecipeRankingInput,
): readonly RankedRecipe[] {
  const available = new Set(input.availableIngredients.map(normalize));
  const excluded = new Set(input.excludedAllergens.map(normalize));
  const safe = recipes.filter((recipe) =>
    recipe.ingredients.every((ingredient) =>
      ingredient.allergens.every((allergen) => !excluded.has(normalize(allergen))),
    ),
  );

  return safe
    .map((recipe) => {
      const matchedIngredients = recipe.ingredients
        .map((ingredient) => ingredient.name)
        .filter((name) => available.has(normalize(name)));
      const missingIngredients = recipe.ingredients
        .map((ingredient) => ingredient.name)
        .filter((name) => !available.has(normalize(name)));
      return {
        recipe,
        matchedIngredients,
        missingIngredients,
        reasonCodes: matchedIngredients.length > 0 ? ["AVAILABLE_INGREDIENT"] : ["NO_MATCH"],
        score:
          recipe.ingredients.length === 0
            ? 0
            : matchedIngredients.length / recipe.ingredients.length,
      };
    })
    .sort(
      (left, right) => right.score - left.score || left.recipe.id.localeCompare(right.recipe.id),
    );
}

export interface NutritionProfile {
  readonly productId: string;
  readonly source: string;
  readonly sourceVersion: string;
  readonly quality: DataQuality;
  readonly servingQuantity: number;
  readonly servingUnit: string;
  readonly calories: number;
  readonly nutrients: Readonly<Record<string, number>>;
}

export interface NutritionResult {
  readonly productId: string;
  readonly source: string;
  readonly quality: DataQuality;
  readonly confidenceLabel: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
  readonly servingQuantity: number;
  readonly servingUnit: string;
  readonly calories: number;
  readonly nutrients: Readonly<Record<string, number>>;
}

export function calculateNutrition(
  profile: NutritionProfile | undefined,
  requestedQuantity: number,
): NutritionResult {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
    throw new Error("Nutrition quantity must be positive.");
  }
  if (profile === undefined) {
    return {
      productId: "unknown",
      source: "none",
      quality: "UNKNOWN",
      confidenceLabel: "UNKNOWN",
      servingQuantity: requestedQuantity,
      servingUnit: "serving",
      calories: 0,
      nutrients: {},
    };
  }

  const multiplier = requestedQuantity / profile.servingQuantity;
  return {
    productId: profile.productId,
    source: profile.source,
    quality: profile.quality,
    confidenceLabel: profile.quality === "VERIFIED" ? "CONFIRMED" : "ESTIMATED",
    servingQuantity: requestedQuantity,
    servingUnit: profile.servingUnit,
    calories: profile.calories * multiplier,
    nutrients: Object.fromEntries(
      Object.entries(profile.nutrients).map(([name, value]) => [name, value * multiplier]),
    ),
  };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
