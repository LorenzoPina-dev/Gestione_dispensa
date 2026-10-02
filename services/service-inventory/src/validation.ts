export type ExpirationSource = "declared" | "estimated";

export function positiveQuantity(value: unknown): number | undefined {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

export function validIfMatch(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= 1;
}

export function isExpirationSource(value: unknown): value is ExpirationSource {
  return value === "declared" || value === "estimated";
}

export function requiredIdempotencyKey(value: string): boolean {
  return value.trim().length > 0;
}
