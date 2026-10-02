import type { ProductDocument } from "./mongo-product-repository.js";

export const CURRENT_CACHE_SCHEMA_VERSION = 2;
export const CURRENT_CACHE_ENRICHMENT_VERSION = 1;

export interface CacheMetadata {
  readonly origin?: "bulk-import" | "live-api" | string;
  readonly cachedAt?: string;
  readonly schemaVersion?: number;
  readonly enrichmentVersion?: number;
  readonly lastRefreshAttemptAt?: string;
  readonly lastRefreshAt?: string;
  readonly lastRefreshOutcome?: "success" | "not_found" | "error" | string;
}

export function getCacheMetadata(product: ProductDocument | Record<string, unknown>): CacheMetadata | undefined {
  const value = product["_cache_meta"];
  return isRecord(value) ? (value as CacheMetadata) : undefined;
}

/**
 * A product is refreshable when its cache has not yet passed the current enrichment contract.
 *
 * We deliberately do NOT treat every optional OFF field that happens to be absent as an
 * infinite refresh condition: Open Food Facts products are legitimately sparse. A successful
 * refresh marks the current enrichment version as attempted, even when OFF itself does not have
 * some optional fields.
 */
export function needsCacheEnrichment(product: ProductDocument | Record<string, unknown>): boolean {
  const meta = getCacheMetadata(product);
  return meta?.enrichmentVersion !== CURRENT_CACHE_ENRICHMENT_VERSION;
}

export function isRefreshCoolingDown(
  product: ProductDocument | Record<string, unknown>,
  nowMs: number,
  cooldownMs: number,
): boolean {
  const attemptedAt = getCacheMetadata(product)?.lastRefreshAttemptAt;
  if (typeof attemptedAt !== "string") return false;

  const timestamp = Date.parse(attemptedAt);
  return Number.isFinite(timestamp) && nowMs - timestamp < cooldownMs;
}

export function mergeMissingFields(
  cached: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...cached };

  for (const [key, freshValue] of Object.entries(fresh)) {
    if (key === "_cache_meta" || key === "code") continue;

    const cachedValue = result[key];

    if (isMeaningfullyMissing(cachedValue)) {
      result[key] = freshValue;
      continue;
    }

    if (isRecord(cachedValue) && isRecord(freshValue)) {
      result[key] = mergeMissingFields(cachedValue, freshValue);
    }
  }

  return result;
}

export function countNewTopLevelFields(
  cached: Record<string, unknown>,
  merged: Record<string, unknown>,
): number {
  return Object.keys(merged).filter(
    (key) => !(key in cached) && !isMeaningfullyMissing(merged[key]),
  ).length;
}

export function isMeaningfullyMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
