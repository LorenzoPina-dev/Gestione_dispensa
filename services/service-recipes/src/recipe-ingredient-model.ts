import {
  canonicalizeIngredient,
  classifyCulinaryWeight,
  foodQuantity,
  parseFoodIngredientLine,
  type CulinaryWeight,
  type FoodQuantity,
} from "@gestione-dispensa/food-rules";
import { resolveFoodIngredient } from "./food-semantics-client.js";

export interface RecipeIngredientSemantic {
  canonicalIngredient: string | null;
  displayName: string;
  foodEntityId: string | null;
  semanticConfidence: number;
  semanticStatus: import("@gestione-dispensa/food-rules").SemanticStatus;
  ingredientTerms: string[];
  culinaryWeight: CulinaryWeight;
  quantity: FoodQuantity | null;
  quantityConfidence: number;
  sourceQuantityRaw: string | null;
  prepState: string | null;
  semanticProvenance: string;
}

export function normalizeRecipeIngredient(name: string, quantity?: number | string | null, unit?: string | null): RecipeIngredientSemantic {
  const rawName = name.trim();
  const parsedLine = parseFoodIngredientLine(rawName);
  const semanticText = parsedLine.ingredientText || rawName;
  const canonical = canonicalizeIngredient(semanticText);
  const explicit = quantity !== null && quantity !== undefined && unit?.trim()
    ? foodQuantity(typeof quantity === "number" ? quantity : String(quantity), String(unit))
    : null;
  const parsed = explicit ?? parsedLine.quantity;
  return {
    canonicalIngredient: canonical.canonicalIngredient,
    displayName: rawName,
    foodEntityId: null,
    semanticConfidence: canonical.confidence,
    semanticStatus: canonical.status,
    ingredientTerms: [...new Set([...canonical.ingredientTerms, rawName.toLowerCase()])],
    culinaryWeight: classifyCulinaryWeight(canonical.canonicalIngredient),
    quantity: parsed,
    quantityConfidence: parsed ? (explicit ? 1 : parsedLine.quantity ? parsedLine.quantityConfidence : 0.82) : 0,
    sourceQuantityRaw: parsed?.sourceRaw ?? null,
    prepState: parsedLine.prepState,
    semanticProvenance: "legacy-local",
  };
}

export async function resolveRecipeIngredient(name: string, quantity?: number | string | null, unit?: string | null, locale = "it-IT"): Promise<RecipeIngredientSemantic> {
  const local = normalizeRecipeIngredient(name, quantity, unit);
  const semanticText = parseFoodIngredientLine(name.trim()).ingredientText || name.trim();
  try {
    const resolved = await resolveFoodIngredient(semanticText, locale);
    const canonical = resolved.canonicalIngredient ?? local.canonicalIngredient;
    return {
      ...local,
      canonicalIngredient: canonical,
      displayName: resolved.displayName?.trim() || local.displayName,
      foodEntityId: resolved.foodEntityId ?? null,
      semanticConfidence: Number(resolved.semanticConfidence ?? 0),
      semanticStatus: resolved.status === "RESOLVED" ? "EXACT" : "UNKNOWN",
      ingredientTerms: [...new Set([...local.ingredientTerms, semanticText.toLowerCase(), resolved.displayName?.toLowerCase() ?? "", ...(resolved.foodEntityAncestors ?? []), ...(resolved.foodEntityId ? [resolved.foodEntityId] : [])])].filter(Boolean),
      culinaryWeight: classifyCulinaryWeight(canonical),
      semanticProvenance: resolved.provenance ?? "food-semantics",
    };
  } catch {
    return local;
  }
}
