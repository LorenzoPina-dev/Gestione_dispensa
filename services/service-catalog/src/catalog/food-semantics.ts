import { canonicalizeIngredient, classifyCulinaryWeight, foodQuantity, normalizeFoodText as norm, normalizeFoodTag as tagName, parseFoodQuantityFromText, parseIngredientText, type CulinaryWeight, type FoodComponent } from "@gestione-dispensa/food-rules";

export interface ProductFoodSemantics {
  productId: string;
  canonicalIngredient: string | null;
  ingredientTerms: string[];
  taxonomyTags: string[];
  allergenTags: string[];
  traceTags: string[];
  labelTags: string[];
  dietaryTags: string[];
  culinaryWeight: CulinaryWeight;
  quantity: { value: number; unit: string } | null;
  quantityBase: { value: number; unit: "g" | "ml" | "piece" } | null;
  quantityConfidence: number;
  semanticConfidence: number;
  components: FoodComponent[];
  compositionConfidence: number;
  source: string;
  sourceVersion: string;
  observedAt: string;
}

function firstNonEmpty(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))] : [];
}

export function deriveProductFoodSemantics(productId: string, raw: Record<string, unknown> | null | undefined, canonicalName?: string | null): ProductFoodSemantics {
  const source = raw ?? {};
  const ingredientTags = stringArray(source.ingredientsTags ?? source.ingredients_tags);
  const categoryTags = stringArray(source.categoriesTags ?? source.categories_tags ?? source.categories_hierarchy);
  const allergenTags = stringArray(source.allergensTags ?? source.allergens_tags).map(tagName);
  const traceTags = stringArray(source.tracesTags ?? source.traces_tags).map(tagName);
  const labelTags = stringArray(source.labelsTags ?? source.labels_tags).map(tagName);
  const productText = firstNonEmpty(
    canonicalName,
    source.productName,
    source.product_name,
  ) ?? "";
  const ingredientText = firstNonEmpty(
    source.ingredientsTextIt,
    source.ingredients_text_it,
    source.ingredientsText,
    source.ingredients_text,
  ) ?? "";

  const canonical = canonicalizeIngredient(productText, [...ingredientTags, ...categoryTags]);
  const components = ingredientText ? parseIngredientText(ingredientText) : [];
  const recognizedComponents = components.filter(component => component.canonicalIngredient);
  const compositionConfidence = components.length > 0
    ? Number((recognizedComponents.length / components.length).toFixed(4))
    : 0;
  const aliases = new Set<string>(canonical.ingredientTerms);
  for (const value of [...ingredientTags, ...categoryTags]) {
    const clean = tagName(value);
    if (clean) aliases.add(norm(clean.replace(/-/g, " ")));
  }

  const dietary = new Set<string>();
  if (labelTags.some((tag) => /vegan/.test(tag))) dietary.add("vegan");
  if (labelTags.some((tag) => /vegetarian/.test(tag))) dietary.add("vegetarian");
  if (labelTags.some((tag) => /gluten[- ]free/.test(tag))) dietary.add("gluten-free");

  const culinaryWeight: CulinaryWeight = classifyCulinaryWeight(canonical.canonicalIngredient);

  const quantityValue =
    typeof source.quantityValue === "number"
      ? source.quantityValue
      : typeof source.quantity_value === "number"
        ? source.quantity_value
        : null;
  const quantityUnit = firstNonEmpty(source.quantityUnit, source.quantity_unit);
  const rawQuantity = firstNonEmpty(source.quantity, source.productQuantity, source.product_quantity);
  const parsedTextQuantity = rawQuantity && quantityValue === null && !quantityUnit
    ? parseFoodQuantityFromText(rawQuantity)
    : null;
  const normalizedQuantity = quantityValue !== null && quantityUnit
    ? foodQuantity(quantityValue, quantityUnit)
    : parsedTextQuantity;

  return {
    productId,
    canonicalIngredient: canonical.canonicalIngredient,
    ingredientTerms: [...aliases],
    taxonomyTags: [...new Set([...ingredientTags, ...categoryTags].map(tagName).filter(Boolean))],
    allergenTags: [...new Set(allergenTags)],
    traceTags: [...new Set(traceTags)],
    labelTags: [...new Set(labelTags)],
    dietaryTags: [...dietary],
    culinaryWeight,
    quantity: normalizedQuantity ? { value: normalizedQuantity.value, unit: normalizedQuantity.unit } : null,
    quantityBase: normalizedQuantity ? { value: normalizedQuantity.baseValue, unit: normalizedQuantity.baseUnit } : null,
    quantityConfidence: normalizedQuantity ? (rawQuantity ? 0.97 : 0.99) : 0,
    semanticConfidence: canonical.confidence,
    components,
    compositionConfidence,
    source: "derived",
    sourceVersion: "food-semantics-v2",
    observedAt: new Date().toISOString()
  };
}

export function semanticsFromProductSnapshot(productId: string, snapshot: Record<string, unknown> | null | undefined, canonicalName?: string | null): ProductFoodSemantics {
  return deriveProductFoodSemantics(productId, snapshot, canonicalName);
}
