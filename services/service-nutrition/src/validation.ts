export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
export function isDiaryUnit(value: unknown): value is "g" | "kg" | "ml" | "l" | "piece" | "pack" {
  return value === "g" || value === "kg" || value === "ml" || value === "l" || value === "piece" || value === "pack";
}
export function isDiarySource(value: unknown): value is "manual" | "inventory" {
  return value === "manual" || value === "inventory";
}
export function isSummaryPeriod(value: unknown): value is "today" | "week" {
  return value === "today" || value === "week";
}
export function validIfMatch(value: string): boolean {
  const normalized = value.replace(/^W\/?/i, "").replace(/"/g, "");
  return /^\d+$/.test(normalized) && Number(normalized) >= 1;
}
