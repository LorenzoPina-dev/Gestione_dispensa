import { foodQuantity, normalizeFoodText } from "@gestione-dispensa/food-rules";
import { combineInventoryQuantity, quantityCoverage, type ParsedQuantity } from "./quantity-engine.js";

export type CulinaryWeight = "STAPLE" | "SECONDARY" | "CORE";
export type Readiness = "READY" | "MINIMAL_SHOPPING" | "DISCARD";

export interface RecipeIngredientForMatch {
  id?: string;
  name: string;
  displayName: string;
  canonicalIngredient?: string | null;
  ingredientTerms?: string[];
  culinaryWeight?: CulinaryWeight;
  quantityValue?: number | null;
  quantityUnit?: string | null;
  quantityDimension?: "mass" | "volume" | "count" | null;
  quantityBaseValue?: number | null;
  quantityBaseUnit?: "g" | "ml" | "piece" | null;
  quantityConfidence?: number;
}

export interface PantryProductForMatch {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  expiresAt?: string | null;
  foodSemantics?: {
    canonicalIngredient?: string | null;
    ingredientTerms?: string[];
    taxonomyTags?: string[];
    quantityBase?: { value: number; unit: "g" | "ml" | "piece" } | null;
  } | null;
}

export interface IngredientMatch {
  recipeIngredient: string;
  canonicalIngredient: string | null;
  culinaryWeight: CulinaryWeight;
  status: "COMPLETE" | "PARTIAL" | "MISSING" | "PRESENCE_ONLY" | "INCOMPATIBLE" | "UNKNOWN";
  ratio: number;
  requiredQuantity: { value: number; unit: string } | null;
  availableQuantity: { value: number; unit: string } | null;
  missingQuantity: { value: number; unit: string } | null;
  productIds: string[];
  confidence: number;
}

export interface PantryRecipeScore {
  score: number;
  readiness: Readiness;
  matchedIngredients: IngredientMatch[];
  missingIngredients: IngredientMatch[];
  matchedProductIds: string[];
  missingCoreCount: number;
  missingCoreWeight: number;
}

function normalizeTerms(values: readonly string[]): Set<string> {
  return new Set(values.map(normalizeFoodText).filter(Boolean));
}

function semanticMatch(recipe: RecipeIngredientForMatch, pantry: PantryProductForMatch): boolean {
  const recipeCanonical = normalizeFoodText(recipe.canonicalIngredient ?? "");
  const pantryCanonical = normalizeFoodText(pantry.foodSemantics?.canonicalIngredient ?? "");
  if (recipeCanonical && pantryCanonical && recipeCanonical === pantryCanonical) return true;
  const recipeTerms = normalizeTerms([...(recipe.ingredientTerms ?? []), recipe.name, recipe.displayName]);
  const pantryTerms = normalizeTerms([...(pantry.foodSemantics?.ingredientTerms ?? []), ...(pantry.foodSemantics?.taxonomyTags ?? []), pantry.name]);
  for (const term of recipeTerms) if (pantryTerms.has(term)) return true;
  return false;
}

function toRequiredQuantity(ingredient: RecipeIngredientForMatch): ParsedQuantity | null {
  if (typeof ingredient.quantityBaseValue === "number" && ingredient.quantityBaseValue > 0 && ingredient.quantityBaseUnit) {
    const dimension = ingredient.quantityDimension ?? (ingredient.quantityBaseUnit === "g" ? "mass" : ingredient.quantityBaseUnit === "ml" ? "volume" : "count");
    return {
      value: typeof ingredient.quantityValue === "number" ? ingredient.quantityValue : ingredient.quantityBaseValue,
      unit: ingredient.quantityUnit ?? ingredient.quantityBaseUnit,
      dimension,
      baseValue: ingredient.quantityBaseValue,
      baseUnit: ingredient.quantityBaseUnit,
      confidence: ingredient.quantityConfidence ?? 0,
      sourceRaw: String(ingredient.quantityBaseValue) + " " + ingredient.quantityBaseUnit,
    };
  }
  if (typeof ingredient.quantityValue === "number" && ingredient.quantityValue > 0 && ingredient.quantityUnit) {
    const parsed = foodQuantity(ingredient.quantityValue, ingredient.quantityUnit);
    if (!parsed) return null;
    return {
      value: parsed.value,
      unit: parsed.unit,
      dimension: parsed.dimension,
      baseValue: parsed.baseValue,
      baseUnit: parsed.baseUnit,
      confidence: ingredient.quantityConfidence ?? 1,
      sourceRaw: parsed.sourceRaw,
    };
  }
  return null;
}

function inventoryQuantities(pantry: PantryProductForMatch[]): ParsedQuantity[] {
  return pantry.map(item => combineInventoryQuantity(item.quantity, item.unit, item.foodSemantics?.quantityBase ?? null)).filter((value): value is ParsedQuantity => value !== null);
}

export function scoreRecipeAgainstPantry(ingredients: readonly RecipeIngredientForMatch[], pantry: readonly PantryProductForMatch[]): PantryRecipeScore {
  const groups = new Map<string, RecipeIngredientForMatch[]>();
  for (const ingredient of ingredients) {
    const canonical = normalizeFoodText(ingredient.canonicalIngredient ?? "");
    const fallback = normalizeFoodText(ingredient.displayName || ingredient.name);
    const key = canonical || fallback;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ingredient);
  }
  const matches: IngredientMatch[] = [];
  let weightedTotal = 0;
  let weightedMatched = 0;
  const matchedProductIds = new Set<string>();
  for (const group of groups.values()) {
    const representative = group[0];
    const weight = representative.culinaryWeight ?? "CORE";
    const groupWeight = group.reduce((sum, item) => sum + (item.culinaryWeight === "STAPLE" ? 0.1 : item.culinaryWeight === "SECONDARY" ? 0.5 : 1), 0);
    const quantities = group.map(toRequiredQuantity);
    const allKnownQuantity = quantities.length > 0 && quantities.every(Boolean);
    const dimension = quantities.find(Boolean)?.dimension ?? null;
    const candidates = pantry.filter(item => group.some(ingredient => semanticMatch(ingredient, item)));
    const available = inventoryQuantities(candidates);
    const sameDimensionQuantities = quantities.filter((item): item is ParsedQuantity => Boolean(item && (!dimension || item.dimension === dimension)));
    const required = allKnownQuantity && dimension && sameDimensionQuantities.length === quantities.length
      ? quantities.reduce((sum, item) => sum + (item as ParsedQuantity).baseValue, 0)
      : null;
    let match: IngredientMatch;
    if (candidates.length === 0) {
      match = { recipeIngredient: representative.displayName || representative.name, canonicalIngredient: representative.canonicalIngredient ?? null, culinaryWeight: weight, status: "MISSING", ratio: 0, requiredQuantity: required !== null ? { value: required, unit: quantities[0]!.baseUnit } : null, availableQuantity: null, missingQuantity: required !== null ? { value: required, unit: quantities[0]!.baseUnit } : null, productIds: [], confidence: Math.min(...group.map(item => item.quantityConfidence ?? 0.5)) };
    } else if (required === null) {
      match = { recipeIngredient: representative.displayName || representative.name, canonicalIngredient: representative.canonicalIngredient ?? null, culinaryWeight: weight, status: "PRESENCE_ONLY", ratio: 1, requiredQuantity: null, availableQuantity: null, missingQuantity: null, productIds: candidates.map(item => item.productId), confidence: Math.min(1, Math.max(0.5, ...candidates.map(item => item.foodSemantics ? 1 : 0.7))) };
    } else {
      const first = quantities[0] as ParsedQuantity;
      const requiredQuantity: ParsedQuantity = { value: required, unit: first.unit, dimension: first.dimension, baseValue: required, baseUnit: first.baseUnit, confidence: Math.min(...quantities.map(item => (item as ParsedQuantity).confidence)), sourceRaw: String(required) + " " + first.baseUnit };
      const coverage = quantityCoverage(requiredQuantity, available);
      match = { recipeIngredient: representative.displayName || representative.name, canonicalIngredient: representative.canonicalIngredient ?? null, culinaryWeight: weight, status: coverage.status, ratio: coverage.ratio, requiredQuantity: { value: required, unit: requiredQuantity.baseUnit }, availableQuantity: coverage.availableBase !== null ? { value: coverage.availableBase, unit: requiredQuantity.baseUnit } : null, missingQuantity: coverage.missingBase !== null && coverage.missingBase > 0 ? { value: coverage.missingBase, unit: requiredQuantity.baseUnit } : null, productIds: candidates.map(item => item.productId), confidence: requiredQuantity.confidence };
    }
    matches.push(match);
    weightedTotal += groupWeight;
    weightedMatched += groupWeight * match.ratio;
    for (const id of match.productIds) matchedProductIds.add(id);
  }
  const score = weightedTotal > 0 ? Number(Math.max(0, Math.min(1, weightedMatched / weightedTotal)).toFixed(4)) : 0;
  const missingIngredients = matches.filter(item => item.ratio < 1);
  const missingCoreCount = missingIngredients.filter(item => item.culinaryWeight === "CORE").length;
  const missingCoreWeight = missingIngredients.filter(item => item.culinaryWeight === "CORE").reduce((sum, item) => sum + (1 - item.ratio), 0);
  return { score, readiness: score >= 0.8 ? "READY" : score >= 0.5 ? "MINIMAL_SHOPPING" : "DISCARD", matchedIngredients: matches, missingIngredients, matchedProductIds: [...matchedProductIds], missingCoreCount, missingCoreWeight: Number(missingCoreWeight.toFixed(4)) };
}
