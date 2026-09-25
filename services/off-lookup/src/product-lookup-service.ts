import type { OffApiClient } from "./off-api-client.js";
import type { ProductRepository } from "./mongo-product-repository.js";
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
 * Implements the Read-Through cache pattern described in the OFF-Lookup spec:
 *
 *   1. look up the barcode in the local MongoDB (bulk dump + previously-cached live results);
 *   2. on a miss, call the live Open Food Facts v3 API;
 *   3. on an API hit, persist the product locally (best effort, never blocks the response) so
 *      the next lookup of the same barcode is a local hit;
 *   4. only a POSITIVE "not found" from the live API becomes a 404 to the caller. Any kind of
 *      infrastructure failure (local DB down, API down/slow/rate-limited) degrades to a
 *      well-labelled "unavailable" outcome instead of a false 404 or an unhandled exception --
 *      this class never throws.
 */
export class ProductLookupService {
  public constructor(
    private readonly repository: ProductRepository,
    private readonly apiClient: OffApiClient,
  ) {}

  public async lookup(barcode: string): Promise<ProductLookupResult> {
    const cached = await this.repository.findByCode(barcode);
    if (cached !== undefined) {
      log("info", "lookup_cache_hit", { barcode });
      return { outcome: "hit", source: "cache", product: cached };
    }

    log("info", "lookup_cache_miss", { barcode });
    const apiResult = await this.apiClient.fetchProduct(barcode);

    if (apiResult.status === "found") {
      // Fire-and-forget: the caller already has their answer, a slow/failing write must never
      // delay or fail the response.
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
}
