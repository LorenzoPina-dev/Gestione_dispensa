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
  return typeof value === "string" && SHOPPING_UNITS.includes(value as ShoppingUnit);
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
