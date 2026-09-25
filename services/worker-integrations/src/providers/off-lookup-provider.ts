import {
  BarcodeProviderError,
  type BarcodeProvider,
  type BarcodeProviderContext,
  type BarcodeProviderResponse,
} from "../barcode.js";

export interface OffLookupProviderOptions {
  /**
   * Base URL of the off-lookup microservice (e.g. http://off-lookup:3200).
   * When unset or empty, every call immediately returns a PROVIDER_UNAVAILABLE error so
   * BarcodeCatalogAdapter degrades to DEGRADED without ever attempting a network call.
   */
  readonly baseUrl?: string | undefined;
  /** Hard per-request timeout. Defaults to 5 000 ms. */
  readonly timeoutMs?: number | undefined;
  /** Consecutive HTTP/network failures before the circuit opens. Defaults to 5. */
  readonly maxConsecutiveFailures?: number | undefined;
  /** How long the circuit stays open before re-attempting. Defaults to 30 000 ms. */
  readonly cooldownMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly now?: (() => number) | undefined;
  readonly log?: ((level: "info" | "error", event: string, fields?: Record<string, unknown>) => void) | undefined;
}

interface OffLookupResponse {
  readonly code?: string;
  readonly source?: "cache" | "live-api";
  readonly product?: Record<string, unknown>;
}

type ProductUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";
const KNOWN_UNITS: readonly ProductUnit[] = ["g", "kg", "ml", "l", "piece", "pack"];

const OFF_CATEGORY_RULES: readonly { readonly match: RegExp; readonly category: string }[] = [
  { match: /meats|fishes|seafood|poultry/, category: "fresh-meat-fish" },
  { match: /fresh-pastas|fresh-doughs/, category: "fresh-milk-pasta" },
  { match: /cheeses|cold-cuts|charcuterie|hams/, category: "cold-cuts-fresh-cheese" },
  { match: /dairies|yogurts|butters|milks/, category: "eggs-dairy" },
  { match: /fruits|vegetables|salads/, category: "produce-fresh" },
  { match: /breads|bakery|viennoiseries/, category: "bakery-fresh" },
  { match: /canned|tomato-purees|sauces|preserves/, category: "canned-preserved" },
  { match: /pastas|rices|legumes|pulses/, category: "dry-staples" },
  { match: /frozen/, category: "frozen-general" },
  { match: /salts|sugars|honeys/, category: "pantry-indefinite" },
];

function normalizeOffCategory(tags: readonly string[] | undefined): string | undefined {
  if (!tags || tags.length === 0) return undefined;
  for (const tag of tags) {
    const rule = OFF_CATEGORY_RULES.find((r) => r.match.test(tag.toLowerCase()));
    if (rule) return rule.category;
  }
  return undefined;
}

function parseDefaultUnit(quantity: string | undefined): ProductUnit {
  if (!quantity) return "piece";
  const match = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i.exec(quantity);
  if (!match) return "piece";
  const unit = match[2]?.toLowerCase();
  if (unit === "kg") return "kg";
  if (unit === "g") return "g";
  if (unit === "l" || unit === "cl") return "l";
  if (unit === "ml") return "ml";
  return "piece";
}

function nutrientValue(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * BarcodeProvider implementation that delegates ALL barcode resolution — local MongoDB
 * lookup, live Open Food Facts API v3 fallback, and read-through cache writes — to the
 * off-lookup microservice (services/off-lookup).
 *
 * Replaces the now-removed combination of OpenFoodFactsProvider + CachingBarcodeProvider +
 * MongoOffCacheRepository in worker-integrations. This service no longer talks to MongoDB or
 * to the Open Food Facts API directly.
 *
 * Fault tolerance:
 *  - every request has its own AbortController deadline (timeoutMs);
 *  - every failure mode (network, timeout, 5xx, 503, malformed JSON) is converted into a typed
 *    BarcodeProviderError, never thrown as a bare Error — BarcodeCatalogAdapter always degrades
 *    to DEGRADED gracefully;
 *  - a circuit breaker opens after maxConsecutiveFailures in a row and returns
 *    PROVIDER_UNAVAILABLE instantly for cooldownMs, so a down/restarting off-lookup container
 *    degrades to instant misses rather than every scan stalling behind the timeout.
 */
export class OffLookupProvider implements BarcodeProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxConsecutiveFailures: number;
  private readonly cooldownMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: NonNullable<OffLookupProviderOptions["log"]>;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public constructor(options: OffLookupProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
  }

  public async lookup(
    identifier: string,
    context: BarcodeProviderContext,
  ): Promise<BarcodeProviderResponse> {
    if (this.baseUrl.length === 0) {
      throw new BarcodeProviderError(
        "PROVIDER_UNAVAILABLE",
        "off-lookup base URL is not configured (OFF_LOOKUP_BASE_URL unset).",
        false,
      );
    }

    if (this.now() < this.circuitOpenUntil) {
      throw new BarcodeProviderError(
        "PROVIDER_UNAVAILABLE",
        "off-lookup circuit breaker is open — service is temporarily unavailable.",
        true,
      );
    }

    const controller = new AbortController();
    // Honour the caller's signal (BarcodeCatalogAdapter's own deadline) AND our own timeout.
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (context.signal.aborted) {
      clearTimeout(timeout);
      throw new BarcodeProviderError("PROVIDER_TIMEOUT", "Request already aborted by caller.", true);
    }
    const abortHandler = () => controller.abort();
    context.signal.addEventListener("abort", abortHandler, { once: true });

    try {
      const url = `${this.baseUrl}/api/v1/products/${encodeURIComponent(identifier)}`;
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (response.status === 404) {
        // off-lookup positively confirmed the barcode does not exist anywhere.
        this.recordSuccess();
        return this.notFoundResponse(identifier);
      }
      if (response.status === 429) {
        this.recordFailure();
        throw new BarcodeProviderError("PROVIDER_RATE_LIMITED", "off-lookup is rate-limited.", true);
      }
      if (response.status === 503) {
        // off-lookup itself is degraded (both local DB and remote API unavailable right now).
        this.recordFailure();
        throw new BarcodeProviderError(
          "PROVIDER_UNAVAILABLE",
          "off-lookup is temporarily unavailable (503).",
          true,
        );
      }
      if (!response.ok) {
        this.recordFailure();
        throw new BarcodeProviderError(
          "PROVIDER_UNAVAILABLE",
          `off-lookup responded with HTTP ${response.status}.`,
          response.status >= 500,
        );
      }

      const body = (await response.json()) as OffLookupResponse;
      this.recordSuccess();
      return this.toProviderResponse(identifier, body);
    } catch (error) {
      if (error instanceof BarcodeProviderError) throw error;
      // Network failure or AbortError (timeout / caller abort).
      this.recordFailure();
      const isTimeout = controller.signal.aborted;
      throw new BarcodeProviderError(
        isTimeout ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
        isTimeout
          ? "off-lookup request exceeded its deadline."
          : `off-lookup request failed: ${error instanceof Error ? error.message : "network error"}.`,
        true,
      );
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", abortHandler);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.circuitOpenUntil = this.now() + this.cooldownMs;
      this.log("error", "off_lookup_provider_circuit_open", {
        cooldownMs: this.cooldownMs,
        resumesAt: new Date(this.circuitOpenUntil).toISOString(),
      });
    }
  }

  /** Converts an off-lookup 200 JSON body into a BarcodeProviderResponse. */
  private toProviderResponse(identifier: string, body: OffLookupResponse): BarcodeProviderResponse {
    const observedAt = new Date().toISOString();
    const base = {
      provider: "openfoodfacts",
      providerRequestId: identifier,
      sourceVersion: body.source === "cache" ? "off-dump-v1" : "off-api-v3",
      observedAt,
    } as const;

    const p = body.product;
    if (!p) return { ...base, quality: "UNKNOWN", confidence: 0, warnings: [] };

    const name = (
      (typeof p["product_name_it"] === "string" ? p["product_name_it"] : "") ||
      (typeof p["product_name"] === "string" ? p["product_name"] : "")
    ).trim();

    if (!name) return { ...base, quality: "UNKNOWN", confidence: 0, warnings: ["missing_name"] };

    const nutriments = (typeof p["nutriments"] === "object" && p["nutriments"] !== null
      ? p["nutriments"]
      : {}) as Record<string, unknown>;
    const isPer100 = (p["nutrition_data_per"] ?? "100g") === "100g";
    const warnings: string[] = isPer100 ? [] : ["nutrition_not_per_100g"];
    const nv = (key: string) => (isPer100 ? nutrientValue(nutriments[key]) : undefined);

    const calories = nv("energy-kcal_100g");
    const protein  = nv("proteins_100g");
    const carbs    = nv("carbohydrates_100g");
    const fat      = nv("fat_100g");
    const fiber    = nv("fiber_100g");
    const hasNutrients = [calories, protein, carbs, fat].some((v) => v !== undefined);

    const brandsRaw = typeof p["brands"] === "string" ? p["brands"] : undefined;
    const brand = brandsRaw?.split(",")[0]?.trim();
    const photoUrl =
      (typeof p["image_front_url"] === "string" ? p["image_front_url"] : undefined) ??
      (typeof p["image_url"] === "string" ? p["image_url"] : undefined);
    const quantity = typeof p["quantity"] === "string" ? p["quantity"] : undefined;

    const categoryTags = Array.isArray(p["categories_tags"])
      ? (p["categories_tags"] as string[])
      : undefined;
    const category = normalizeOffCategory(categoryTags);

    const defaultUnit = parseDefaultUnit(quantity);
    const knownUnit: ProductUnit = KNOWN_UNITS.includes(defaultUnit as ProductUnit)
      ? (defaultUnit as ProductUnit)
      : "piece";

    return {
      ...base,
      quality: hasNutrients ? "IMPORTED" : "ESTIMATED",
      confidence: hasNutrients ? 0.85 : 0.6,
      warnings,
      product: {
        canonicalName: name,
        ...(brand ? { brand } : {}),
        defaultUnit: knownUnit,
        ...(photoUrl ? { photoUrl } : {}),
        ...(calories !== undefined ? { calories } : {}),
        ...(protein !== undefined ? { protein } : {}),
        ...(carbs !== undefined ? { carbs } : {}),
        ...(fat !== undefined ? { fat } : {}),
        ...(fiber !== undefined ? { fiber } : {}),
        ...(category ? { category } : {}),
      },
    };
  }

  /** Returns a well-formed "product not in OFF" response (no product field → NOT_FOUND path). */
  private notFoundResponse(identifier: string): BarcodeProviderResponse {
    return {
      provider: "openfoodfacts",
      providerRequestId: identifier,
      sourceVersion: "off-api-v3",
      observedAt: new Date().toISOString(),
      quality: "UNKNOWN",
      confidence: 0,
      warnings: [],
    };
  }
}
