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

    // OpenSearch is the fast local projection. Do not require it to contain the whole dump:
    // Mongo remains the authoritative local fallback for name searches.
    let openSearchResult: OffSearchResult | undefined;
    if (this.localSearch !== undefined) {
      try {
        openSearchResult = await this.localSearch.search(normalizedQuery, boundedLimit, traceId);
        if (openSearchResult?.status === "found" && openSearchResult.hits.length >= boundedLimit) {
          const result = { ...openSearchResult, source: "local" } as OffSearchResult;
          this.searchCache.set(normalizedQuery, { at: now, result });
          this.trimSearchCache();
          return result;
        }
      } catch (error) {
        log("error", "local_product_search_failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    // Complete an incomplete OpenSearch response with the full local Mongo dump. The Mongo
    // query is forced to use the dedicated _keywords index, so a missing index never triggers
    // a collection scan: it simply degrades to the remote OFF API.
    try {
      const mongoPage = await this.repository.searchByName(normalizedQuery, boundedLimit);
      if (mongoPage?.items.length) {
        const mongoHits = rankMongoSearchHits(normalizedQuery, mongoPage.items, boundedLimit);
        const mergedHits = mergeSearchHits(openSearchResult?.hits ?? [], mongoHits, boundedLimit);
        const result = { status: "found", hits: mergedHits, source: "local" } as OffSearchResult;

        this.searchCache.set(normalizedQuery, { at: Date.now(), result });
        this.trimSearchCache();

        for (const hit of mongoHits) {
          this.indexProductAsync(hit.code, hit.product);
        }
        return result;
      }
    } catch (error) {
      log("warn", "mongo_name_search_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    if (this.apiClient.searchProducts === undefined) {
      const result = openSearchResult?.status === "found" ? openSearchResult : { status: "found", hits: [] };
      return result;
    }

    const external = await this.apiClient.searchProducts(normalizedQuery, boundedLimit);
    if (external.status === "found" && external.hits.length > 0) {
      // External results complement, rather than replace, any partial local projection.
      // This keeps locally known products visible even when the provider returns fewer hits.
      const externalHits = external.hits.map((hit) => ({
        code: hit.code,
        product: hit.product,
        score: hit.score,
      }));
      const localHits = openSearchResult?.status === "found" ? openSearchResult.hits : [];
      const mergedHits = mergeSearchHits(localHits, externalHits, boundedLimit);
      const result = { status: "found", hits: mergedHits, source: "local" } as OffSearchResult;

      this.searchCache.set(normalizedQuery, { at: Date.now(), result });
      this.trimSearchCache();

      // Seed the local Mongo/OpenSearch caches asynchronously. The remote hit is returned
      // immediately, so persistence latency is invisible to the user.
      for (const hit of external.hits) {
        void this.repository.upsertFromLiveApi(hit.code, hit.product)
          .then(() => this.indexProductAsync(hit.code, hit.product))
          .catch((error: unknown) => {
            log("error", "search_result_cache_write_failed", {
              code: hit.code,
              error: error instanceof Error ? error.message : "unknown",
            });
          });
      }

      return result;
    }

    // A provider miss/error must never erase a valid partial local result.
    if (openSearchResult?.status === "found" && openSearchResult.hits.length > 0) {
      const result = { ...openSearchResult, source: "local" } as OffSearchResult;
      this.searchCache.set(normalizedQuery, { at: Date.now(), result });
      this.trimSearchCache();
      return result;
    }

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

function rankMongoSearchHits(
  query: string,
  items: readonly { code: string; product: Record<string, unknown> }[],
  limit: number,
): readonly { code: string; product: Record<string, unknown>; score: number }[] {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  return items
    .map((item) => {
      const product = item.product;
      const name = normalizeSearchText(firstString(product.product_name_it, product.product_name_en, product.product_name) ?? "");
      const brand = normalizeSearchText(firstString(product.brands) ?? "");
      const category = normalizeSearchText(firstString(product.category) ?? "");
      const nameTokens = new Set(name.split(" ").filter(Boolean));

      const exact = name === normalizedQuery ? 10000 : 0;
      const prefix = name.startsWith(normalizedQuery) ? 3000 : 0;
      const contains = name.includes(normalizedQuery) ? 1500 : 0;
      const allTokens = queryTokens.every((token) => nameTokens.has(token)) ? 1000 : 0;
      const tokenMatches = queryTokens.filter((token) => nameTokens.has(token)).length * 150;
      const brandMatch = brand.includes(normalizedQuery) ? 250 : 0;
      const categoryMatch = category.includes(normalizedQuery) ? 50 : 0;

      return {
        code: item.code,
        product,
        score: exact + prefix + contains + allTokens + tokenMatches + brandMatch + categoryMatch,
      };
    })
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, Math.min(Math.max(Math.floor(limit), 1), 20));
}

function mergeSearchHits(
  primary: readonly { code: string; product: Record<string, unknown>; score: number }[],
  secondary: readonly { code: string; product: Record<string, unknown>; score: number }[],
  limit: number,
): readonly { code: string; product: Record<string, unknown>; score: number }[] {
  const byCode = new Map<string, { code: string; product: Record<string, unknown>; score: number }>();
  for (const hit of [...primary, ...secondary]) {
    const existing = byCode.get(hit.code);
    if (existing === undefined || hit.score > existing.score) byCode.set(hit.code, hit);
  }
  return [...byCode.values()]
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, Math.min(Math.max(Math.floor(limit), 1), 20));
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}
