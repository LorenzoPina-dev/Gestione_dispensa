export const SHOPPING_UNITS = ["g", "kg", "ml", "l", "piece", "pack"] as const;
export type ShoppingUnit = (typeof SHOPPING_UNITS)[number];

export function normalizeListName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function positiveQuantity(value: unknown): number | undefined {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

export function isShoppingUnit(value: unknown): value is ShoppingUnit {
  return typeof value === "string" && SHOPPING_UNITS.includes(value.toLowerCase() as ShoppingUnit);
}

/** Origin of an item. Matches the ShoppingItemAdded vocabulary (docs/EVENTS.md). */
export const SHOPPING_SOURCES = ["manual", "recipe", "low_stock", "offer"] as const;
export type ShoppingSource = (typeof SHOPPING_SOURCES)[number];

export function isShoppingSource(value: unknown): value is ShoppingSource {
  return typeof value === "string" && SHOPPING_SOURCES.includes(value as ShoppingSource);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Catalog product reference: absent, null or a UUID (the column is uuid, anything else would be a 500). */
export function isOptionalUuid(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === "string" && UUID_PATTERN.test(value));
}

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8;
}

export function parseIfMatch(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "").trim();
  const versionMatch = normalized.match(/^version-(\d+)$/i);
  const raw = versionMatch ? versionMatch[1] : normalized;
  if (!/^\d+$/.test(raw)) return undefined;
  const version = Number(raw);
  return Number.isInteger(version) && version >= 1 ? version : undefined;
}

export function validFamilyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
