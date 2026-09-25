import type { BarcodeProvider, BarcodeProviderContext, BarcodeProviderResponse } from "../barcode.js";
import type { OffCacheRepository } from "../off-cache-repository.js";

export interface CachingBarcodeProviderOptions {
  readonly inner: BarcodeProvider;
  readonly cache: OffCacheRepository;
  readonly log: (level: "info" | "error", event: string, fields?: Record<string, unknown>) => void;
  readonly now?: () => number;
}

/**
 * Decorates a BarcodeProvider (Open Food Facts today) with a cache-first pipeline:
 *
 *   1. look up `identifier` in the cache repository;
 *   2. on a hit, return the cached response immediately -- no external call at all;
 *   3. on a miss, call the wrapped provider exactly like before this cache existed;
 *   4. on a successful provider response, write it back to the cache in the background so the
 *      next scan of the same product is a cache hit, without delaying this response.
 *
 * The cache is an optional accelerator, never a dependency: any cache failure (down, absent,
 * slow, misconfigured) is caught here and treated as a plain miss, so lookups always fall
 * through to the exact same live-API behaviour that existed before caching was introduced.
 */
export class CachingBarcodeProvider implements BarcodeProvider {
  private readonly inner: BarcodeProvider;
  private readonly cache: OffCacheRepository;
  private readonly log: CachingBarcodeProviderOptions["log"];
  private readonly now: () => number;

  public constructor(options: CachingBarcodeProviderOptions) {
    this.inner = options.inner;
    this.cache = options.cache;
    this.log = options.log;
    this.now = options.now ?? Date.now;
  }

  public async lookup(
    identifier: string,
    context: BarcodeProviderContext,
  ): Promise<BarcodeProviderResponse> {
    const cached = await this.safeGet(identifier);
    if (cached !== undefined) {
      this.log("info", "off_cache_hit", { traceId: context.traceId, identifier });
      return cached.response;
    }

    this.log("info", "off_cache_miss", { traceId: context.traceId, identifier });
    const response = await this.inner.lookup(identifier, context);
    // Fire-and-forget: never let a slow or failing cache write hold up the caller, who already
    // has their answer at this point.
    void this.safeSet(identifier, response).catch(() => {
      // safeSet already logs; this catch only exists to satisfy the no-floating-promises intent.
    });
    return response;
  }

  private async safeGet(identifier: string) {
    try {
      return await this.cache.get(identifier);
    } catch (error) {
      this.log("error", "off_cache_get_failed", {
        identifier,
        error: error instanceof Error ? error.message : "unknown",
      });
      return undefined;
    }
  }

  private async safeSet(identifier: string, response: BarcodeProviderResponse): Promise<void> {
    try {
      await this.cache.set({
        identifier,
        response,
        cachedAt: new Date(this.now()).toISOString(),
        origin: "live",
      });
    } catch (error) {
      this.log("error", "off_cache_set_failed", {
        identifier,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}
