import {
  canonicalizeIngredient,
  classifyCulinaryWeight,
  foodQuantity,
  parseFoodQuantityFromText,
  type CulinaryWeight,
  type FoodQuantity,
} from "@gestione-dispensa/food-rules";

export interface RecipeIngredientSemantic {
  canonicalIngredient: string | null;
  semanticConfidence: number;
  semanticStatus: import("@gestione-dispensa/food-rules").SemanticStatus;
  ingredientTerms: string[];
  culinaryWeight: CulinaryWeight;
  quantity: FoodQuantity | null;
  quantityConfidence: number;
  sourceQuantityRaw: string | null;
  prepState: string | null;
}

export function normalizeRecipeIngredient(
  name: string,
  quantity?: number | string | null,
  unit?: string | null,
): RecipeIngredientSemantic {
  const rawName=name.trim();
  const canonical=canonicalizeIngredient(rawName);
  const explicit=quantity !== null && quantity !== undefined && unit?.trim()
    ? foodQuantity(typeof quantity==="number" ? quantity : String(quantity),String(unit))
    : null;
  const embedded=explicit ? null : parseFoodQuantityFromText(rawName);
  const parsed=explicit ?? embedded;
  return {
    canonicalIngredient:canonical.canonicalIngredient,
    semanticConfidence:canonical.confidence,
    semanticStatus:canonical.status,
    ingredientTerms:[...new Set([...canonical.ingredientTerms, rawName.toLowerCase()])],
    culinaryWeight:classifyCulinaryWeight(canonical.canonicalIngredient),
    quantity:parsed,
    quantityConfidence:parsed ? (explicit ? 1 : 0.9) : 0,
    sourceQuantityRaw:parsed?.sourceRaw ?? null,
    prepState:null,
  };
}
