export type ShelfLifeProductContext = {
  category?: string | null;
  name?: string | null;
  openFoodFacts?: Record<string, unknown> | null;
};

/**
 * Resolves the shelf-life profile class from Catalog data.
 *
 * Open Food Facts category tags are not sufficiently reliable to distinguish
 * fresh food from shelf-stable preserved food (for example canned tuna may be
 * tagged as fresh-meat-fish). Positive preservation signals therefore take
 * precedence over the broad OFF category.
 */
export function resolveShelfLifeCategory(context: ShelfLifeProductContext): string | null {
  const category = normalize(context.category);
  const fields = [
    context.name,
    ...stringValues(context.openFoodFacts?.packaging),
    ...stringValues(context.openFoodFacts?.labelsTags),
    ...stringValues(context.openFoodFacts?.categoriesTags),
  ].map(normalize).filter(Boolean) as string[];

  const joined = fields.join(" ");

  if (hasAny(joined, [
    "canned", "tinned", "tin", "retort", "preserved", "preserve",
    "canned-fish", "tinned-fish", "preserved-fish", "can", "cans",
    "en:conserves", "en:canned-foods", "en:canned-fish",
    "en:tinned-foods", "en:tinned-fish", "en:preserved-foods",
    "en:preserved-fish", "in scatola", "inscatol", "conserva",
    "conserve", "conservato", "shelf stable", "shelf-stable", "long-life", "lattina", "lattine", "scatola", "scatole", "latta", "sottolio",
  ])) {
    return "canned-preserved";
  }

  if (hasAny(joined, [
    "frozen", "deep frozen", "deep-frozen",
    "en:frozen-foods", "en:frozen-fish", "en:frozen-meals",
    "surgelat", "congelat",
  ])) {
    return "frozen-general";
  }

  return category;
}

function hasAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => {
    if (term.includes(" ")) return value.includes(term);
    return new RegExp("(^|[^a-z0-9])" + escapeRegex(term) + "([^a-z0-9]|$)", "i").test(value);
  });
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function normalize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}
