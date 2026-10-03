import type { OffApiClient, OffSearchResult } from "./off-api-client.js";
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

export interface LocalProductSearchClient {
  search(query: string, limit: number, traceId?: string): Promise<OffSearchResult | undefined>;
}

export interface ProductIndexWriter {
  upsert(code: string, product: Record<string, unknown>): Promise<void>;
}

const BARCODE_PATTERN = /^\d{6,14}$/;

export function isValidBarcode(value: string): boolean {
  return BARCODE_PATTERN.test(value);
}

/**
 * Read-through lookup with two deliberately separate paths:
 *
 *  - barcode: Mongo first, then the live OFF API; successful misses are cached in Mongo and indexed
 *    in OpenSearch asynchronously;
 *  - text: OpenSearch only, because it is populated automatically from the complete Mongo dump.
 *    On an OpenSearch miss, the live OFF search API is the fallback and its hits are persisted to
 *    Mongo and OpenSearch asynchronously.
 *
 * Barcode cache enrichment is conservative: existing values are preserved and only missing fields
 * are filled. A refresh cooldown prevents repeated failed calls; in-flight refreshes are coalesced
 * per barcode inside this service instance.
 *
 * Existing values are never overwritten by a refresh. This is intentional: the cache is an
 * accelerator/fallback, and Open Food Facts data is sparse and may change independently.
 */
export class ProductLookupService {
  private readonly refreshInFlight = new Map<string, Promise<ProductLookupResult>>();
  private readonly searchCache = new Map<string, { at: number; result: OffSearchResult }>();

  public constructor(
    private readonly repository: ProductRepository,
    private readonly apiClient: OffApiClient,
    private readonly localSearch?: LocalProductSearchClient,
    private readonly indexWriter?: ProductIndexWriter,
  ) {}

  public async search(query: string, limit = 10, traceId?: string): Promise<OffSearchResult> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < 3) return { status: "found", hits: [] };

    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 20);
    const now = Date.now();
    const cached = this.searchCache.get(normalizedQuery);
    if (cached !== undefined && now - cached.at < config.offApi.searchCacheMs) {
      return cached.result;
    }

    let openSearchResult: OffSearchResult | undefined;
    if (this.localSearch !== undefined) {
      try {
        openSearchResult = await this.localSearch.search(normalizedQuery, boundedLimit, traceId);
      } catch (error) {
        log("error", "local_product_search_failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    // OpenSearch is the authoritative local text-search index. Mongo is intentionally
    // NOT queried by name: it remains the source-of-truth/cache for barcode and the source
    // used by search-indexer during the one-time resumable bulk projection.
    if (openSearchResult?.status === "found" && openSearchResult.hits.length > 0) {
      const result = { ...openSearchResult, source: "local" } as OffSearchResult;
      this.searchCache.set(normalizedQuery, { at: Date.now(), result });
      this.trimSearchCache();
      return result;
    }

    if (this.apiClient.searchProducts === undefined) {
      if (openSearchResult?.status === "found") return openSearchResult;
      return { status: "found", hits: [] };
    }

    const external = await this.apiClient.searchProducts(normalizedQuery, boundedLimit);
    if (external.status === "found" && external.hits.length > 0) {
      const result = { ...external, source: "external" } as OffSearchResult;

      this.searchCache.set(normalizedQuery, { at: Date.now(), result });
      this.trimSearchCache();

      // An external search hit becomes local data asynchronously. Mongo keeps the raw/complete
      // cache copy, while OpenSearch receives the compact searchable projection used by future
      // text searches. The live response never waits for either write.
      for (const hit of external.hits) {
        // Keep Mongo as the complete cache/source of truth when available, but do not make
        // OpenSearch population depend on Mongo write latency or availability.
        void this.repository.upsertFromLiveApi(hit.code, hit.product).catch((error: unknown) => {
          log("error", "search_result_cache_write_failed", {
            code: hit.code,
            error: error instanceof Error ? error.message : "unknown",
          });
        });
        this.indexProductAsync(hit.code, hit.product);
      }

      return result;
    }

    // OpenSearch had no result and the external provider also had none. Preserve the
    // provider's status/error semantics; there is no Mongo text-search fallback anymore.
    return { ...external, source: "external" } as OffSearchResult;
  }

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

  private trimSearchCache(): void {
    if (this.searchCache.size <= 50) return;
    const oldest = [...this.searchCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) this.searchCache.delete(oldest[0]);
  }

  private indexProductAsync(code: string, product: Record<string, unknown>): void {
    if (this.indexWriter === undefined) return;
    void this.indexWriter.upsert(code, product).catch((error: unknown) => {
      log("error", "search_index_upsert_failed", {
        code,
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  }

  private async lookupWithoutCache(barcode: string): Promise<ProductLookupResult> {
    log("info", "lookup_cache_miss", { barcode });
    const apiResult = await this.apiClient.fetchProduct(barcode);

    if (apiResult.status === "found") {
      // A cache write is deliberately best-effort. The API result is already a valid response.
      void this.repository.upsertFromLiveApi(barcode, apiResult.product)
        .then(() => this.indexProductAsync(barcode, apiResult.product))
        .catch((error: unknown) => {
          log("error", "lookup_cache_or_index_write_failed", {
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
      void this.repository.upsertFromLiveApi(barcode, merged)
        .then(() => this.indexProductAsync(barcode, merged))
        .catch((error: unknown) => {
          log("error", "lookup_cache_refresh_or_index_write_failed", {
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

    log("error", "lookup_cache_refresh_failed_using_cache", {
      barcode,
      reason: apiResult.reason,
    });

    return { outcome: "hit", source: "cache", product: cached };
  }
}

