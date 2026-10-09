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
import { normalizeOffProduct } from "./off-canonical.js";

export interface ProductLookupProvenance {
  /** Where the persisted product originated. */
  readonly origin: "bulk-import" | "live-api";
  /** True when live OFF data has been merged into a product originating from the dump. */
  readonly enrichedFromLiveApi: boolean;
}

export type ProductLookupResult =
  | {
      readonly outcome: "hit";
      readonly source: "cache" | "live-api";
      readonly product: Record<string, unknown>;
      readonly provenance: ProductLookupProvenance;
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
 * Local-first Open Food Facts boundary. Mongo contains the dump/cache representation; the
 * derivation layer turns that representation into the API-shaped view. The live API is used only
 * when the configured local contract cannot be satisfied or when the barcode is absent.
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
    if (cached !== undefined && now - cached.at < config.offApi.searchCacheMs) return cached.result;

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

    if (openSearchResult?.status === "found" && openSearchResult.hits.length > 0) {
      const result = {
        ...openSearchResult,
        source: "local",
        hits: openSearchResult.hits.map((hit) => ({
          code: hit.code,
          product: this.derive(hit.code, hit.product).product,
        })),
      } as OffSearchResult;
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
      const result = {
        ...external,
        source: "external",
        hits: external.hits.map((hit) => ({
          code: hit.code,
          product: this.derive(hit.code, hit.product).product,
        })),
      } as OffSearchResult;
      this.searchCache.set(normalizedQuery, { at: Date.now(), result });
      this.trimSearchCache();
      for (const hit of external.hits) {
        void this.repository.upsertFromLiveApi(hit.code, hit.product)
          .catch((error: unknown) => log("error", "search_result_cache_write_failed", {
            code: hit.code,
            error: error instanceof Error ? error.message : "unknown",
          }))
          .then(() => this.indexSearchHit(hit.code, hit.product));
      }
      return result;
    }

    return {
      ...external,
      source: "external",
      hits: external.hits.map((hit) => ({
        code: hit.code,
        product: this.derive(hit.code, hit.product).product,
      })),
    } as OffSearchResult;
  }

  public async lookup(barcode: string, options: LookupOptions = {}): Promise<ProductLookupResult> {
    const normalizedBarcode = normalizeBarcode(barcode);
    const allowRemote = options.allowRemote !== false;
    const cached = await this.repository.findByCode(normalizedBarcode);

    if (cached === undefined) {
      if (!allowRemote) return { outcome: "not_found" };
      return this.lookupWithoutCache(normalizedBarcode);
    }

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
    if (existingRefresh !== undefined) return existingRefresh;

    const refreshPromise = this.refreshCachedProduct(normalizedBarcode, cached);
    this.refreshInFlight.set(normalizedBarcode, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshInFlight.get(normalizedBarcode) === refreshPromise) this.refreshInFlight.delete(normalizedBarcode);
    }
  }

  private derive(code: string, product: Record<string, unknown>): DerivationResult {
    const derived = deriveProductFields(code, product, this.policy.derivation);
    const canonical = normalizeOffProduct(code, derived.product, this.policy.derivation);
    return {
      product: canonical,
      derived: derived.derived,
    };
  }

  private hit(
    source: "cache" | "live-api",
    derived: DerivationResult,
    provenance?: ProductLookupProvenance,
  ): ProductLookupResult {
    return {
      outcome: "hit",
      source,
      product: derived.product,
      provenance: provenance ?? inferProvenance(derived.product),
      ...(derived.derived.length > 0 ? { derivedFields: derived.derived } : {}),
    };
  }

  private shouldEnrichRemotely(derivedProduct: Record<string, unknown>): boolean {
    switch (this.policy.remoteEnrichment) {
      case "never":
        return false;
      case "always":
        return needsCacheEnrichment(derivedProduct);
      case "missing":
        if (getCacheMetadata(derivedProduct)?.enrichmentVersion === CURRENT_CACHE_ENRICHMENT_VERSION) return false;
        return this.policy.requiredLocalFields.some((field) => isRequiredFieldMissing(derivedProduct, field));
    }
  }

  private trimSearchCache(): void {
    if (this.searchCache.size <= 50) return;
    const oldest = [...this.searchCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) this.searchCache.delete(oldest[0]);
  }

  private async indexSearchHit(code: string, hit: Record<string, unknown>): Promise<void> {
    let source: Record<string, unknown> = hit;
    try {
      const stored = await this.repository.findByCode(code);
      if (stored !== undefined) source = stored;
    } catch {
      // Mongo is an optional accelerator.
    }
    this.indexProductAsync(code, this.derive(code, source).product);
  }

  private indexProductAsync(code: string, product: Record<string, unknown>): void {
    if (this.indexWriter === undefined) return;
    void this.indexWriter.upsert(code, product).catch((error: unknown) => log("error", "search_index_upsert_failed", {
      code,
      error: error instanceof Error ? error.message : "unknown",
    }));
  }

  private async lookupWithoutCache(barcode: string): Promise<ProductLookupResult> {
    log("info", "lookup_cache_miss", { barcode });
    const apiResult = await this.apiClient.fetchProduct(barcode);

    if (apiResult.status === "found") {
      const local = this.derive(barcode, apiResult.product);
      void this.repository.upsertFromLiveApi(barcode, apiResult.product)
        .then(() => this.indexProductAsync(barcode, local.product))
        .catch((error: unknown) => log("error", "lookup_cache_or_index_write_failed", {
          barcode,
          error: error instanceof Error ? error.message : "unknown",
        }));
      return this.hit("live-api", local, { origin: "live-api", enrichedFromLiveApi: false });
    }

    if (apiResult.status === "not_found") return { outcome: "not_found" };
    log("error", "lookup_degraded", { barcode, reason: apiResult.reason });
    return { outcome: "unavailable", reason: apiResult.reason };
  }

  private async refreshCachedProduct(barcode: string, cached: ProductDocument): Promise<ProductLookupResult> {
    log("info", "lookup_cache_refresh_started", { barcode });
    const apiResult = await this.apiClient.fetchProduct(barcode);

    if (apiResult.status === "found") {
      const merged = mergeMissingFields(cached, apiResult.product);
      const local = this.derive(barcode, merged);
      void this.repository.upsertFromLiveApi(barcode, merged)
        .then(() => this.indexProductAsync(barcode, local.product))
        .catch((error: unknown) => log("error", "lookup_cache_refresh_or_index_write_failed", {
          barcode,
          error: error instanceof Error ? error.message : "unknown",
        }));
      log("info", "lookup_cache_refresh_succeeded", { barcode, hadCachedProduct: true });
      return this.hit("cache", local, {
        origin: inferProvenance(cached).origin,
        enrichedFromLiveApi: true,
      });
    }

    if (apiResult.status === "not_found") {
      void this.repository.recordRefreshAttempt(barcode, "not_found").catch((error: unknown) => log("error", "lookup_cache_refresh_metadata_failed", {
        barcode,
        error: error instanceof Error ? error.message : "unknown",
      }));
      return this.hit("cache", this.derive(barcode, cached));
    }

    void this.repository.recordRefreshAttempt(barcode, "error").catch((error: unknown) => log("error", "lookup_cache_refresh_metadata_failed", {
      barcode,
      error: error instanceof Error ? error.message : "unknown",
    }));
    log("error", "lookup_cache_refresh_failed_using_cache", { barcode, reason: apiResult.reason });
    return this.hit("cache", this.derive(barcode, cached));
  }
}

function inferProvenance(product: Record<string, unknown>): ProductLookupProvenance {
  const metadata = getCacheMetadata(product);
  const origin: ProductLookupProvenance["origin"] = metadata?.origin === "live-api" ? "live-api" : "bulk-import";
  return {
    origin,
    enrichedFromLiveApi: origin === "bulk-import" && metadata?.enrichmentVersion === CURRENT_CACHE_ENRICHMENT_VERSION,
  };
}
