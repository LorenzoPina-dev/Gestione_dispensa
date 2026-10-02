export const STORE_OFFER_TYPES = ["percentage", "fixed"] as const;
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function isCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}
export function isOfferType(value: unknown): value is "percentage" | "fixed" {
  return value === "percentage" || value === "fixed";
}
export function isValidDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}
export function isPositiveOffer(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
