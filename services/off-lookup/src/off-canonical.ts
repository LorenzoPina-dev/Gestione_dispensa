/**
 * Canonical Open Food Facts boundary.
 *
 * This is the only place above the raw providers where OFF's dump/API shape is interpreted.
 * Mongo rows and live API responses are both normalized through this module. The normalizer is
 * deliberately idempotent: if a canonical product is normalized again, its raw
 * `openFoodFacts` payload is used as the source of truth.
 */
import {
  deriveProductFields,
  defaultDerivationOptions,
  resolveImages,
  imageUrl,
  localizedText,
  type DerivationOptions,
  type ImageKind,
} from "./off-derived.js";

export interface CanonicalImage {
  readonly url: string | null;
  readonly small: string | null;
  readonly thumb: string | null;
}

export interface OffCanonicalProduct {
  readonly code: string;
  readonly name: string | null;
  readonly brand: string | null;
  readonly quantity: { readonly value: number | null; readonly unit: string | null; readonly label: string | null };
  readonly serving: { readonly quantity: number | null; readonly unit: string | null; readonly label: string | null };
  readonly category: string | null;
  readonly images: {
    readonly front: CanonicalImage;
    readonly ingredients: CanonicalImage;
    readonly nutrition: CanonicalImage;
    readonly packaging: CanonicalImage;
  };
  readonly nutrition: Record<string, unknown>;
  readonly ingredients: { readonly text: string | null };
  readonly packaging: { readonly text: string | null };
  readonly traces: readonly string[];
  readonly labels: readonly string[];
  readonly categories: readonly string[];
  readonly countries: readonly string[];
  readonly nutriScore: { readonly grade: string | null; readonly score: number | null };
  readonly nova: { readonly group: number | null };
  readonly ecoScore: { readonly grade: string | null; readonly score: number | null };
  readonly openFoodFacts: Record<string, unknown>;
  /** Flat OFF-compatible aliases retained for existing consumers during the contract migration. */
  readonly image_front_url: string | null;
  readonly image_front_small_url: string | null;
  readonly image_front_thumb_url: string | null;
  readonly image_ingredients_url: string | null;
  readonly image_ingredients_small_url: string | null;
  readonly image_ingredients_thumb_url: string | null;
  readonly image_nutrition_url: string | null;
  readonly image_nutrition_small_url: string | null;
  readonly image_nutrition_thumb_url: string | null;
  readonly image_packaging_url: string | null;
  readonly image_packaging_small_url: string | null;
  readonly image_packaging_thumb_url: string | null;
  readonly image_url: string | null;
  readonly image_small_url: string | null;
  readonly image_thumb_url: string | null;
  readonly product_name: string | null;
  readonly brands: string | null;
  readonly quantity_label: string | null;
  readonly product_quantity: number | null;
  readonly product_quantity_unit: string | null;
}

const IMAGE_KINDS: readonly ImageKind[] = ["front", "ingredients", "nutrition", "packaging"];

export function normalizeOffProduct(
  code: string,
  input: Record<string, unknown>,
  options: DerivationOptions = defaultDerivationOptions(),
): Record<string, unknown> {
  const raw = isRecord(input.openFoodFacts) ? input.openFoodFacts : input;
  const derived = deriveProductFields(code, raw, options).product;
  const images = buildImages(code, derived, options);
  const name = firstString(
    derived.product_name,
    localizedText(derived, "product_name", options.languages),
    derived.product_name_it,
    derived.product_name_en,
  );
  const brand = firstCsvValue(derived.brands);
  const quantityValue = numberOf(derived.product_quantity) ?? parseQuantity(derived.quantity);
  const quantityUnit = firstString(derived.product_quantity_unit) ?? inferUnit(derived.quantity);
  const quantityLabel = firstString(derived.quantity)
    ?? (quantityValue !== null ? `${quantityValue}${quantityUnit ? ` ${quantityUnit}` : ""}` : null);
  const servingQuantity = numberOf(derived.serving_quantity) ?? parseQuantity(derived.serving_size);
  const servingUnit = firstString(derived.serving_quantity_unit) ?? inferUnit(derived.serving_size);
  const servingLabel = firstString(derived.serving_size)
    ?? (servingQuantity !== null ? `${servingQuantity}${servingUnit ? ` ${servingUnit}` : ""}` : null);

  const nutrition = isRecord(derived.nutriments) ? { ...derived.nutriments } : {};
  const categories = stringArray(derived.categories_tags ?? derived.categories_hierarchy);
  const countries = stringArray(derived.countries_tags ?? derived.countries_hierarchy);
  const traces = stringArray(derived.traces_tags ?? derived.traces_hierarchy);
  const labels = stringArray(derived.labels_tags ?? derived.labels_hierarchy);

  const nutriScore = {
    grade: firstString(derived.nutriscore_grade, derived.nutriscore_score ? undefined : null),
    score: numberOf(derived.nutriscore_score),
  };
  const nova = { group: numberOf(derived.nova_group) };
  const ecoScore = {
    grade: firstString(derived.ecoscore_grade),
    score: numberOf(derived.ecoscore_score),
  };

  const canonical: Record<string, unknown> = {
    ...derived,
    code,
    name,
    brand,
    quantity: { value: quantityValue, unit: quantityUnit, label: quantityLabel },
    serving: { quantity: servingQuantity, unit: servingUnit, label: servingLabel },
    category: normalizeCategory(categories, name),
    images,
    nutrition,
    ingredients: { text: firstString(derived.ingredients_text, derived.ingredients_text_it) },
    packaging: { text: firstString(derived.packaging_text, derived.packaging_text_it) },
    traces,
    labels,
    categories,
    countries,
    nutriScore,
    nova,
    ecoScore,
    openFoodFacts: { ...derived },
    image_front_url: images.front.url,
    image_front_small_url: images.front.small,
    image_front_thumb_url: images.front.thumb,
    image_ingredients_url: images.ingredients.url,
    image_ingredients_small_url: images.ingredients.small,
    image_ingredients_thumb_url: images.ingredients.thumb,
    image_nutrition_url: images.nutrition.url,
    image_nutrition_small_url: images.nutrition.small,
    image_nutrition_thumb_url: images.nutrition.thumb,
    image_packaging_url: images.packaging.url,
    image_packaging_small_url: images.packaging.small,
    image_packaging_thumb_url: images.packaging.thumb,
    image_url: images.front.url,
    image_small_url: images.front.small,
    image_thumb_url: images.front.thumb,
    product_name: name,
    brands: brand,
    quantity_label: quantityLabel,
    product_quantity: quantityValue,
    product_quantity_unit: quantityUnit,
  };
  delete canonical._cache_meta;
  return canonical;
}

function buildImages(
  code: string,
  product: Record<string, unknown>,
  options: DerivationOptions,
): Record<ImageKind, CanonicalImage> {
  const resolved = resolveImages(product, options);
  const result = {} as Record<ImageKind, CanonicalImage>;
  for (const kind of IMAGE_KINDS) {
    const image = resolved[kind];
    result[kind] = {
      url: image ? imageUrl(options, code, image, "display") : firstString(product[`image_${kind}_url`]),
      small: image ? imageUrl(options, code, image, "small") : firstString(product[`image_${kind}_small_url`]),
      thumb: image ? imageUrl(options, code, image, "thumb") : firstString(product[`image_${kind}_thumb_url`]),
    };
  }
  return result;
}

const CATEGORY_RULES: readonly { readonly match: RegExp; readonly category: string }[] = [
  { match: /meats|fishes|seafood|poultry/, category: "fresh-meat-fish" },
  { match: /fresh-pastas|fresh-doughs/, category: "fresh-milk-pasta" },
  { match: /cheeses|cold-cuts|charcuterie|hams/, category: "cold-cuts-fresh-cheese" },
  { match: /dairies|yogurts|butters|milks/, category: "eggs-dairy" },
  { match: /fruits|vegetables|salads|produce/, category: "produce-fresh" },
  { match: /breads|bakery|viennoiseries/, category: "bakery-fresh" },
  { match: /cand(?:y|ies)|candies|confectioner(?:y|ies)|sugar-confectionery|bonbons|caramels|toffees|pastilles|mints|lozenges|caramell|dolciumi|mentine|confiserie/, category: "confectionery-candy" },
  { match: /chewing-gum|chewing gum|bubble-gum|gomme-a-macher|gomme à mâcher/, category: "chewing-gum" },
  { match: /chocolates|chocolate|cocoa-products|cacao/, category: "chocolate-confectionery" },
  { match: /biscuits|cookies|crackers|wafers|sweet-biscuits|savory-biscuits/, category: "biscuits-crackers" },
  { match: /breakfast-cereals|cereals|mueslis|granolas/, category: "breakfast-cereals" },
  { match: /coffee|coffees|tea|teas|infusions/, category: "coffee-tea" },
  { match: /nuts|peanuts|seeds|snacks|chips|crisps|popcorn/, category: "nuts-snacks" },
  { match: /pastas|rices|legumes|pulses|flours|couscous|grains/, category: "dry-staples" },
  { match: /canned|tomato-purees|preserves|pickles|jams|jellies|compotes/, category: "canned-preserved" },
  { match: /sauces|condiments|mustards|mayonnaises|ketchups|dressings/, category: "sauces-condiments" },
  { match: /oils|fats|olive-oils|sunflower-oils/, category: "oils-fats" },
  { match: /water|waters|soft-drinks|sodas|juices|nectars|iced-teas|shelf-stable-beverages/, category: "shelf-stable-beverages" },
  { match: /salts|sugars|honeys|sugar|salt/, category: "pantry-indefinite" },
  { match: /frozen/, category: "frozen-general" },
];

function normalizeCategory(tags: readonly string[], productName: string | null): string | null {
  const values = [...tags, productName ?? ""].map((v) => v.toLowerCase().trim()).filter(Boolean);
  for (const value of values) {
    const rule = CATEGORY_RULES.find((candidate) => candidate.match.test(value));
    if (rule) return rule.category;
  }
  return tags.at(-1) ?? null;
}

function firstCsvValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",").map((v) => v.trim()).find(Boolean);
  return first ?? null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return match ? numberOf(match[1]) : null;
}

function inferUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\b(kg|g|mg|l|cl|ml)\b/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
