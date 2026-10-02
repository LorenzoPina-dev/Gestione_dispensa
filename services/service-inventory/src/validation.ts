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

export const CONSUME_REASONS = ["used", "expired", "damaged", "other"] as const;
export type ConsumeReason = (typeof CONSUME_REASONS)[number];

export function isConsumeReason(value: unknown): value is ConsumeReason {
  return typeof value === "string" && CONSUME_REASONS.includes(value as ConsumeReason);
}

export function isPatchFieldSet(body: Record<string, unknown>): boolean {
  const allowed = ["quantity", "location", "expiresAt", "lotCode", "openedAt"];
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every((key) => allowed.includes(key));
}

export function validOptionalText(value: unknown): boolean {
  return value === null || typeof value === "string";
}

export function validIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  return !Number.isNaN(new Date(value).getTime());
}
