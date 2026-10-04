import type { OffApiClient, OffSearchResult } from "./off-api-client.js";
import type { ProductRepository, ProductDocument } from "./mongo-product-repository.js";
import {
  CURRENT_CACHE_ENRICHMENT_VERSION,
  getCacheMetadata,
  isRefreshCoolingDown,
  mergeMissingFields,
  needsCacheEnrichment,
} from "./cache-policy.js";
import { config } from "./config.js";
import {
  defaultDerivationOptions,
  deriveProductFields,
  isRequiredFieldMissing,
  type DerivationOptions,
  type DerivationResult,
} from "./off-derived.js";
import { log } from "./logger.js";

export type ProductLookupResult =
  | {
      readonly outcome: "hit";
      readonly source: "cache" | "live-api";
      readonly product: Record<string, unknown>;
      /** Fields computed locally from the persisted data (absent when nothing was derived). */
      readonly derivedFields?: readonly string[];
    }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "unavailable"; readonly reason: string };

export interface LocalProductSearchClient {
  search(query: string, limit: number, traceId?: string): Promise<OffSearchResult | undefined>;
}

export interface ProductIndexWriter {
  upsert(code: string, product: Record<string, unknown>): Promise<void>;
}

/**
 * When the live OFF API may be used for a product that already exists in the local dump.
 *  - "missing": only when a field in `requiredLocalFields` is still missing AFTER local derivation;
 *  - "always":  legacy behaviour, one refresh pass for every product not yet enriched;
 *  - "never":   the API is only used when the barcode is absent from the local dump.
 */
export interface LookupPolicy {
  readonly remoteEnrichment: "missing" | "always" | "never";
  readonly requiredLocalFields: readonly string[];
  readonly derivation: DerivationOptions;
}

export interface LookupOptions {
  /** false = answer from the local dump only; the OFF API is never called. */
  readonly allowRemote?: boolean;
}

export function defaultLookupPolicy(): LookupPolicy {
  return {
    remoteEnrichment: config.lookup.remoteEnrichment,
    requiredLocalFields: config.lookup.requiredLocalFields,
    derivation: defaultDerivationOptions(),
  };
}

const BARCODE_PATTERN = /^\d{6,14}$/;

export function normalizeBarcode(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

export function isValidBarcode(value: string): boolean {
  return BARCODE_PATTERN.test(normalizeBarcode(value));
}

/**
 * Read-through lookup, local-first:
 *
 *  - barcode: Mongo first. The persisted document is passed through the derivation layer
 *    (off-derived.ts) which computes, WITHOUT any network call, the fields the OFF API would add
 *    (image URLs, language-resolved names, ...). The live API is consulted only when the barcode
 *    is not in Mongo, or when a field declared required (`requiredLocalFields`) is still missing
 *    after derivation. Successful live results are cached in Mongo (raw, never derived) and
 *    indexed in OpenSearch asynchronously;
 *  - text: OpenSearch only, because it is populated automatically from the complete Mongo dump.
 *    On an OpenSearch miss, the live OFF search API is the fallback and its hits are persisted to
 *    Mongo and OpenSearch asynchronously.
 *
 * Enrichment is conservative: existing values are preserved and only missing fields are filled.
 * A refresh cooldown prevents repeated failed calls; in-flight refreshes are coalesced per barcode
 * inside this service instance.
 *
 * Derived values are NEVER written to Mongo: they are deterministic functions of persisted data,
 * so storing them would only duplicate data and let it drift from the derivation rules.
 */
export class ProductLookupService {
  private readonly refreshInFlight = new Map<string, Promise<ProductLookupResult>>();
  private readonly searchCache = new Map<string, { at: number; result: OffSearchResult }>();
  private readonly policy: LookupPolicy;

  public constructor(
    private readonly repository: ProductRepository,
    private readonly apiClient: OffApiClient,
    private readonly localSearch?: LocalProductSearchClient,
    private readonly indexWriter?: ProductIndexWriter,
    policy: Partial<LookupPolicy> = {},
  ) {
    this.policy = { ...defaultLookupPolicy(), ...policy };
  }

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
      //
      // The projection is built from what Mongo holds AFTER the conservative merge, not from the
      // raw live-search payload: that payload is much poorer (often no image fields at all) and
      // indexing it would overwrite a good document with one that has lost its picture.
      for (const hit of external.hits) {
        void this.repository.upsertFromLiveApi(hit.code, hit.product)
          .catch((error: unknown) => {
            log("error", "search_result_cache_write_failed", {
              code: hit.code,
              error: error instanceof Error ? error.message : "unknown",
            });
          })
          // OpenSearch population must not depend on Mongo write latency or availability.
          .then(() => this.indexSearchHit(hit.code, hit.product));
      }

      return result;
    }

    // OpenSearch had no result and the external provider also had none. Preserve the
    // provider's status/error semantics; there is no Mongo text-search fallback anymore.
    return { ...external, source: "external" } as OffSearchResult;
  }

  public async lookup(barcode: string, options: LookupOptions = {}): Promise<ProductLookupResult> {
    const normalizedBarcode = normalizeBarcode(barcode);
    const allowRemote = options.allowRemote !== false;
    const cached = await this.repository.findByCode(normalizedBarcode);

    if (cached === undefined) {
      if (!allowRemote) return { outcome: "not_found" };
      return this.lookupWithoutCache(normalizedBarcode);
    }

    // Everything derivable is computed first; only then is "do we still need the API?" decided.
    const local = this.derive(normalizedBarcode, cached);

    if (
      !allowRemote ||
      !this.shouldEnrichRemotely(local.product) ||
      isRefreshCoolingDown(cached, Date.now(), config.offApi.refreshCooldownMs)
    ) {
      log("info", "lookup_cache_hit", { barcode: normalizedBarcode, derived: local.derived.length });
      return this.hit("cache", local);
    }

    const existingRefresh = this.refreshInFlight.get(normalizedBarcode);
    if (existingRefresh !== undefined) {
      return existingRefresh;
    }

    const refreshPromise = this.refreshCachedProduct(normalizedBarcode, cached);
    this.refreshInFlight.set(normalizedBarcode, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      if (this.refreshInFlight.get(normalizedBarcode) === refreshPromise) {
        this.refreshInFlight.delete(normalizedBarcode);
      }
    }
  }

  private derive(code: string, product: Record<string, unknown>): DerivationResult {
    return deriveProductFields(code, product, this.policy.derivation);
  }

  private hit(source: "cache" | "live-api", derived: DerivationResult): ProductLookupResult {
    return {
      outcome: "hit",
      source,
      product: derived.product,
      ...(derived.derived.length > 0 ? { derivedFields: derived.derived } : {}),
    };
  }

  /** Whether the live API is worth calling for a product that is already in the local dump. */
  private shouldEnrichRemotely(derivedProduct: Record<string, unknown>): boolean {
    switch (this.policy.remoteEnrichment) {
      case "never":
        return false;
      case "always":
        return needsCacheEnrichment(derivedProduct);
      case "missing": {
        // A previous successful refresh already asked OFF: do not ask again just because OFF
        // itself does not have the field.
        if (getCacheMetadata(derivedProduct)?.enrichmentVersion === CURRENT_CACHE_ENRICHMENT_VERSION) {
          return false;
        }
        return this.policy.requiredLocalFields.some((field) => isRequiredFieldMissing(derivedProduct, field));
      }
    }
  }

  private trimSearchCache(): void {
    if (this.searchCache.size <= 50) return;
    const oldest = [...this.searchCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) this.searchCache.delete(oldest[0]);
  }

  /**
   * Indexes a live-search hit using the document stored in Mongo when there is one (it keeps
   * every field a previous dump/lookup already provided, images included), and the raw hit
   * otherwise. Derived fields are added before indexing. Never throws.
   */
  private async indexSearchHit(code: string, hit: Record<string, unknown>): Promise<void> {
    let source: Record<string, unknown> = hit;
    try {
      const stored = await this.repository.findByCode(code);
      if (stored !== undefined) source = stored;
    } catch {
      // Mongo is an optional accelerator: fall back to the live payload.
    }
    this.indexProductAsync(code, this.derive(code, source).product);
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
      const local = this.derive(barcode, apiResult.product);
      // A cache write is deliberately best-effort. The API result is already a valid response.
      // The raw API payload is what gets stored; only the index receives the derived view.
      void this.repository.upsertFromLiveApi(barcode, apiResult.product)
        .then(() => this.indexProductAsync(barcode, local.product))
        .catch((error: unknown) => {
          log("error", "lookup_cache_or_index_write_failed", {
            barcode,
            error: error instanceof Error ? error.message : "unknown",
          });
        });
      return this.hit("live-api", local);
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
      const local = this.derive(barcode, merged);

      // The repository performs the same conservative merge again against the current DB
      // document. This closes the common race where another request enriches the same barcode
      // while this refresh is in flight. The response does not wait for the optional DB write.
      void this.repository.upsertFromLiveApi(barcode, merged)
        .then(() => this.indexProductAsync(barcode, local.product))
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

      return this.hit("cache", local);
    }

    if (apiResult.status === "not_found") {
      void this.repository.recordRefreshAttempt(barcode, "not_found").catch((error: unknown) => {
        log("error", "lookup_cache_refresh_metadata_failed", {
          barcode,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
      // Never delete a previously cached product merely because a later lookup got a 404.
      return this.hit("cache", this.derive(barcode, cached));
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

    return this.hit("cache", this.derive(barcode, cached));
  }
}
