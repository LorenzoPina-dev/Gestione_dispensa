import type { IdentifierType, ProductUnit } from "./service.js";
import type { ExternalBarcodeLookupClient, ExternalProductMatch } from "./workflow.js";

export interface HttpOffLookupClientOptions {
  /**
   * Base URL of the off-lookup microservice (e.g. http://off-lookup:3200).
   * The client calls GET /api/v1/products/{barcode} on this host.
   */
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Consecutive failures before the circuit opens and skips the network call entirely. */
  readonly circuitBreakThreshold?: number;
  /** How long (ms) the circuit stays open before trying again. */
  readonly circuitResetMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/** Shape returned by GET /api/v1/products/:barcode on off-lookup (HTTP 200). */
interface OffLookupProduct {
  readonly product_name?: string;
  readonly product_name_it?: string;
  readonly brands?: string;
  readonly image_front_url?: string;
  readonly image_url?: string;
  readonly quantity?: string;
  readonly nutriments?: Record<string, unknown>;
  readonly nutrition_data_per?: string;
  readonly categories_tags?: readonly string[];
  // Allow any extra OFF field without failing the parse.
  readonly [field: string]: unknown;
}

interface OffLookupHitBody {
  readonly code: string;
  readonly source: "cache" | "live-api";
  readonly product: OffLookupProduct;
}

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

/**
 * Calls the off-lookup microservice (services/off-lookup) directly — the single authoritative
 * source for barcode → product resolution in this stack. off-lookup implements the Read-Through
 * cache pattern: it checks the local Open Food Facts MongoDB dump first and falls back to the
 * live OFF API v3, transparently.
 *
 * This client is built to NEVER throw and NEVER slow down or fail a barcode scan:
 *  - every request has its own hard AbortController timeout;
 *  - every failure mode (network, timeout, non-2xx, malformed JSON) resolves to `undefined`
 *    — "no external match available right now" — so CatalogWorkflowService degrades to UNKNOWN
 *    (manual entry) instead of returning a 500 to the user;
 *  - a small circuit breaker skips calling off-lookup for circuitResetMs after repeated
 *    failures, so a down or restarting off-lookup container degrades to instant UNKNOWN rather
 *    than every scan waiting out the full timeout.
 */
export class HttpOffLookupClient implements ExternalBarcodeLookupClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly circuitBreakThreshold: number;
  private readonly circuitResetMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public constructor(options: HttpOffLookupClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.circuitBreakThreshold = options.circuitBreakThreshold ?? 5;
    this.circuitResetMs = options.circuitResetMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  public async lookup(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
    traceId: string;
  }): Promise<ExternalProductMatch | undefined> {
    if (this.now() < this.circuitOpenUntil) {
      // Circuit open: off-lookup has been failing repeatedly — degrade instantly without a
      // network call rather than making every barcode scan wait out the full timeout.
      return undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}/api/v1/products/${encodeURIComponent(input.normalizedValue)}`;
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (response.status === 404) {
        // off-lookup confirmed the barcode does not exist: clean miss, not a failure.
        this.recordSuccess();
        return undefined;
      }
      if (response.status === 503) {
        // off-lookup is itself degraded (both local DB and live API unavailable). Treat as a
        // transient failure rather than a permanent miss so the circuit breaker can open and
        // we stop hammering a degraded service.
        this.recordFailure();
        return undefined;
      }
      if (!response.ok) {
        this.recordFailure();
        return undefined;
      }

      const body = (await response.json()) as OffLookupHitBody;
      this.recordSuccess();
      return toExternalMatch(body);
    } catch {
      // Network error, timeout (AbortError), non-JSON body — all degrade silently to "no match".
      this.recordFailure();
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitBreakThreshold) {
      this.circuitOpenUntil = this.now() + this.circuitResetMs;
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }
}

function toExternalMatch(body: OffLookupHitBody): ExternalProductMatch | undefined {
  const p = body.product;
  if (!p) return undefined;

  const name = (
    (typeof p.product_name_it === "string" ? p.product_name_it : "") ||
    (typeof p.product_name === "string" ? p.product_name : "")
  ).trim();
  if (!name) return undefined;

  const nutriments = (typeof p.nutriments === "object" && p.nutriments !== null
    ? p.nutriments
    : {}) as Record<string, unknown>;
  const isPer100 = (p.nutrition_data_per ?? "100g") === "100g";
  const nv = (key: string): number | undefined => {
    const val = nutriments[key];
    return isPer100 && typeof val === "number" && Number.isFinite(val) ? val : undefined;
  };

  const calories = nv("energy-kcal_100g");
  const protein  = nv("proteins_100g");
  const carbs    = nv("carbohydrates_100g");
  const fat      = nv("fat_100g");
  const fiber    = nv("fiber_100g");
  const hasNutrients = [calories, protein, carbs, fat].some((v) => v !== undefined);

  const brand = (typeof p.brands === "string" ? p.brands : undefined)?.split(",")[0]?.trim();
  const photoUrl =
    (typeof p.image_front_url === "string" ? p.image_front_url : undefined) ??
    (typeof p.image_url === "string" ? p.image_url : undefined);
  const category = normalizeOffCategory(
    Array.isArray(p.categories_tags) ? (p.categories_tags as string[]) : undefined,
  );
  const rawUnit = parseDefaultUnit(typeof p.quantity === "string" ? p.quantity : undefined);
  const defaultUnit: ProductUnit = KNOWN_UNITS.includes(rawUnit) ? rawUnit : "piece";

  return {
    canonicalName: name,
    ...(brand ? { brand } : {}),
    defaultUnit,
    ...(photoUrl ? { photoUrl } : {}),
    ...(calories !== undefined ? { calories } : {}),
    ...(protein !== undefined ? { protein } : {}),
    ...(carbs !== undefined ? { carbs } : {}),
    ...(fat !== undefined ? { fat } : {}),
    ...(fiber !== undefined ? { fiber } : {}),
    ...(category ? { category } : {}),
    source: "openfoodfacts",
    sourceVersion: body.source === "cache" ? "off-dump-v1" : "off-api-v3",
    confidence: hasNutrients ? 0.85 : 0.6,
  };
}
