import type { OffApiClient } from "./off-api-client.js";
import type { ProductRepository, ProductDocument } from "./mongo-product-repository.js";
import {
  isRefreshCoolingDown,
  mergeMissingFields,
  needsCacheEnrichment,
} from "./cache-policy.js";
import { config } from "./config.js";
import { log } from "./logger.js";

export type ProductLookupResult =
  | { readonly outcome: "hit"; readonly source: "cache" | "live-api"; readonly product: Record<string, unknown> }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "unavailable"; readonly reason: string };

const BARCODE_PATTERN = /^\d{6,14}$/;

export function isValidBarcode(value: string): boolean {
  return BARCODE_PATTERN.test(value);
}

/**
 * Read-through lookup with conservative cache enrichment:
 *
 *  1. Read Mongo first (official dump and previous live API results share the same collection).
 *  2. On a miss, call OFF and asynchronously persist the result.
 *  3. On an old/incompletely enriched cache entry, call OFF once and merge ONLY missing fields.
 *  4. If OFF fails or says the barcode is no longer present, keep and return the previous cache.
 *  5. A refresh cooldown prevents repeated failed calls; in-flight refreshes are coalesced per
 *     barcode inside this service instance.
 *
 * Existing values are never overwritten by a refresh. This is intentional: the cache is an
 * accelerator/fallback, and Open Food Facts data is sparse and may change independently.
 */
export class ProductLookupService {
  private readonly refreshInFlight = new Map<string, Promise<ProductLookupResult>>();

  public constructor(
    private readonly repository: ProductRepository,
    private readonly apiClient: OffApiClient,
  ) {}

  public async lookup(barcode: string): Promise<ProductLookupResult> {
    const cached = await this.repository.findByCode(barcode);

    if (cached === undefined) {
      return this.lookupWithoutCache(barcode);
    }

    if (
      !needsCacheEnrichment(cached) ||
      isRefreshCoolingDown(cached, Date.now(), config.offApi.refreshCooldownMs)
    ) {
      log("info", "lookup_cache_hit", { barcode });
      return { outcome: "hit", source: "cache", product: cached };
    }

    const existingRefresh = this.refreshInFlight.get(barcode);
    if (existingRefresh !== undefined) {
      return existingRefresh;
    }

    const refreshPromise = this.refreshCachedProduct(barcode, cached);
    this.refreshInFlight.set(barcode, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      if (this.refreshInFlight.get(barcode) === refreshPromise) {
        this.refreshInFlight.delete(barcode);
      }
    }
  }

  private async lookupWithoutCache(barcode: string): Promise<ProductLookupResult> {
    log("info", "lookup_cache_miss", { barcode });
    const apiResult = await this.apiClient.fetchProduct(barcode);

    if (apiResult.status === "found") {
      // A cache write is deliberately best-effort. The API result is already a valid response.
      void this.repository.upsertFromLiveApi(barcode, apiResult.product).catch((error: unknown) => {
        log("error", "lookup_cache_write_failed", {
          barcode,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
      return { outcome: "hit", source: "live-api", product: apiResult.product };
    }

    if (apiResult.status === "not_found") {
      return { outcome: "not_found" };
    }

    log("error", "lookup_degraded", { barcode, reason: apiResult.reason });
    return { outcome: "unavailable", reason: apiResult.reason };
  }

  private async refreshCachedProduct(
    barcode: string,
    cached: ProductDocument,
  ): Promise<ProductLookupResult> {
    log("info", "lookup_cache_refresh_started", { barcode });

    const apiResult = await this.apiClient.fetchProduct(barcode);

    if (apiResult.status === "found") {
      const merged = mergeMissingFields(cached, apiResult.product);

      // The repository performs the same conservative merge again against the current DB
      // document. This closes the common race where another request enriches the same barcode
      // while this refresh is in flight. The response does not wait for the optional DB write.
      void this.repository.upsertFromLiveApi(barcode, merged).catch((error: unknown) => {
        log("error", "lookup_cache_refresh_write_failed", {
          barcode,
          error: error instanceof Error ? error.message : "unknown",
        });
      });

      log("info", "lookup_cache_refresh_succeeded", {
        barcode,
        hadCachedProduct: true,
      });

      return { outcome: "hit", source: "cache", product: merged };
    }

    if (apiResult.status === "not_found") {
      void this.repository.recordRefreshAttempt(barcode, "not_found").catch((error: unknown) => {
        log("error", "lookup_cache_refresh_metadata_failed", {
          barcode,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
      // Never delete a previously cached product merely because a later lookup got a 404.
      return { outcome: "hit", source: "cache", product: cached };
    }

    void this.repository.recordRefreshAttempt(barcode, "error").catch((error: unknown) => {
      log("error", "lookup_cache_refresh_metadata_failed", {
        barcode,
        error: error instanceof Error ? error.message : "unknown",
      });
    });

    log("warn", "lookup_cache_refresh_failed_using_cache", {
      barcode,
      reason: apiResult.reason,
    });

    return { outcome: "hit", source: "cache", product: cached };
  }
}
