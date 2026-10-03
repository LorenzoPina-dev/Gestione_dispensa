import { config } from "./config.js";
import { log } from "./logger.js";

/**
 * Outcome of a live Open Food Facts API call, kept deliberately separate from HTTP semantics:
 *  - "found": the barcode exists on Open Food Facts; `product` is the raw product object exactly
 *    as OFF returns it, so it can be stored locally in the same shape as a bulk-imported dump row.
 *  - "not_found": OFF positively confirmed this barcode does not exist in its database. This is
 *    the ONLY case that should ever become an HTTP 404 to our callers.
 *  - "error": the call could not be completed (network failure, timeout, rate limit, 5xx,
 *    malformed payload). Absence here is NOT confirmed -- callers must not treat this as 404.
 */
export type OffApiResult =
  | { readonly status: "found"; readonly product: Record<string, unknown> }
  | { readonly status: "not_found" }
  | { readonly status: "error"; readonly reason: string; readonly retryable: boolean };

export interface OffSearchHit {
  readonly code: string;
  readonly product: Record<string, unknown>;
}

export interface OffSearchResult {
  readonly status: "found" | "error";
  readonly hits: readonly OffSearchHit[];
  readonly reason?: string;
  readonly source?: "local" | "external";
}

export interface OffApiClient {
  fetchProduct(barcode: string): Promise<OffApiResult>;
  searchProducts?(query: string, limit: number): Promise<OffSearchResult>;
  isCircuitOpen(): boolean;
}

interface OffV3Response {
  // v3 uses a string status ("success" | "failure" | ...); older mirrors/tests may still send the
  // v2-style numeric 0/1. Both are handled defensively.
  readonly status?: string | number;
  readonly product?: Record<string, unknown>;
}

/**
 * Thin client for the public Open Food Facts v3 product API
 * (https://world.openfoodfacts.org/api/v3/product/{barcode}.json). No API key required.
 *
 * Fault tolerance:
 *  - every request has its own hard timeout (`config.offApi.timeoutMs`) via AbortController;
 *  - every failure mode (network error, timeout, non-2xx, unparsable JSON) is converted into a
 *    typed `{ status: "error" }` result, never thrown;
 *  - a small circuit breaker opens after `maxConsecutiveFailures` in a row and skips the network
 *    call entirely for `cooldownMs`, so a genuinely down Open Food Facts degrades to instant
 *    "error" results instead of every request queueing behind the same timeout.
 */
export class OpenFoodFactsApiClient implements OffApiClient {
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  public async searchProducts(query: string, limit: number): Promise<OffSearchResult> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) return { status: "found", hits: [] };

    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 20);
    // Search-a-Licious/Open Food Facts can interpret multi-word queries more strictly than
    // the product-name UX expects. Try the full query first, then individual tokens, and
    // merge/deduplicate the hits. The final filter keeps only products whose name contains
    // every requested token, so the fallback cannot turn "lemon soda" into arbitrary soda.
    const candidates = buildSearchQueries(normalizedQuery);
    const merged = new Map<string, OffSearchHit>();
    let lastError: string | undefined;

    for (const candidate of candidates) {
      const result = await this.searchOnce(candidate, boundedLimit);
      if (result.status === "error") {
        lastError = result.reason;
        continue;
      }
      for (const hit of result.hits) {
        const key = hit.code;
        if (!merged.has(key)) merged.set(key, hit);
      }
      if (merged.size >= boundedLimit && hasAllQueryTokens([...merged.values()], normalizedQuery)) break;
    }

    const hits = [...merged.values()]
      .filter((hit) => matchesAllQueryTokens(hit.product, normalizedQuery))
      .slice(0, boundedLimit);

    if (hits.length > 0) {
      this.recordSuccess();
      return { status: "found", hits };
    }

    return lastError
      ? { status: "error", hits: [], reason: lastError }
      : { status: "found", hits: [] };
  }

  private async searchOnce(query: string, limit: number): Promise<OffSearchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.offApi.searchTimeoutMs);
    try {
      const url = new URL("/search", config.offApi.searchBaseUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("page", "1");
      url.searchParams.set("page_size", String(limit));
      url.searchParams.set("boost_phrase", "true");
      for (const lang of ["it", "en"]) url.searchParams.append("langs", lang);
      for (const field of [
        "code", "product_name", "product_name_it", "brands", "quantity",
        "product_quantity", "product_quantity_unit", "image_front_url",
        "image_front_small_url", "categories_tags", "nutriments",
        "nutrition_data_per", "popularity_key", "completeness",
      ]) url.searchParams.append("fields", field);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": config.offApi.userAgent,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return {
          status: "error",
          hits: [],
          reason: response.status === 429 ? "rate_limited" : `http_${response.status}`,
        };
      }

      const body = (await response.json()) as { hits?: unknown; products?: unknown };
      const rawHits = Array.isArray(body.hits) ? body.hits : Array.isArray(body.products) ? body.products : [];
      const hits: OffSearchHit[] = [];

      for (const raw of rawHits) {
        if (!raw || typeof raw !== "object") continue;
        const value = raw as Record<string, unknown>;
        const code = typeof value.code === "string" ? value.code.trim() : "";
        if (!/^\d{8,14}$/.test(code)) continue;

        const product =
          isRecord(value._source) ? value._source :
          isRecord(value.product) ? value.product :
          value;
        if (!isRecord(product)) continue;

        const name =
          (typeof product.product_name_it === "string" ? product.product_name_it : "") ||
          (typeof product.product_name === "string" ? product.product_name : "");
        if (!name.trim()) continue;

        hits.push({ code, product });
      }

      return { status: "found", hits };
    } catch (error) {
      return {
        status: "error",
        hits: [],
        reason: controller.signal.aborted
          ? "timeout"
          : error instanceof Error ? error.message : "network_error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  public async fetchProduct(barcode: string): Promise<OffApiResult> {
    if (this.isCircuitOpen()) {
      return { status: "error", reason: "circuit_open", retryable: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.offApi.timeoutMs);
    try {
      const url = `${config.offApi.baseUrl.replace(/\/+$/, "")}/api/v3/product/${encodeURIComponent(barcode)}.json?product_type=food&lc=it&generate_images_urls=1`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": config.offApi.userAgent, Accept: "application/json" },
      });

      if (response.status === 404) {
        this.recordSuccess();
        return { status: "not_found" };
      }
      if (response.status === 429) {
        this.recordFailure();
        return { status: "error", reason: "rate_limited", retryable: true };
      }
      if (!response.ok) {
        this.recordFailure();
        return { status: "error", reason: `http_${response.status}`, retryable: response.status >= 500 };
      }

      const body = (await response.json()) as OffV3Response;
      this.recordSuccess();

      const found = body.status === "success" || body.status === 1;
      if (found && body.product && Object.keys(body.product).length > 0) {
        return { status: "found", product: body.product };
      }
      return { status: "not_found" };
    } catch (error) {
      this.recordFailure();
      const reason = controller.signal.aborted
        ? "timeout"
        : error instanceof Error
          ? error.message
          : "network_error";
      return { status: "error", reason, retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= config.offApi.maxConsecutiveFailures) {
      this.circuitOpenUntil = Date.now() + config.offApi.cooldownMs;
      log("error", "off_api_circuit_open", {
        cooldownMs: config.offApi.cooldownMs,
        resumesAt: new Date(this.circuitOpenUntil).toISOString(),
      });
    }
  }
}

function buildSearchQueries(query: string): string[] {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  return [...new Set([
    query,
    tokens.length > 1 ? tokens.join(" ") : "",
    ...tokens.filter((token) => token.length >= 3),
  ].filter(Boolean))];
}

function matchesAllQueryTokens(product: Record<string, unknown>, query: string): boolean {
  const name = normalizeSearchText(
    (typeof product.product_name_it === "string" ? product.product_name_it : "") ||
    (typeof product.product_name === "string" ? product.product_name : ""),
  );
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => name.includes(token));
}

function hasAllQueryTokens(hits: OffSearchHit[], query: string): boolean {
  return hits.some((hit) => matchesAllQueryTokens(hit.product, query));
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}