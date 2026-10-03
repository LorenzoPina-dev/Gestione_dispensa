import type { IdentifierType, ProductUnit } from "./service.js";
import type {
  ExternalBarcodeLookupClient,
  ExternalProductMatch,
  ExternalProductSearchClient,
  ExternalProductSearchHit,
} from "./workflow.js";

export interface HttpOffLookupClientOptions {
  /**
   * Base URL of the off-lookup microservice (e.g. http://off-lookup:3200).
   * The client calls GET /api/v1/products/{barcode} on this host.
   */
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Hard timeout for product-name search; intentionally longer than barcode resolution. */
  readonly searchTimeoutMs?: number;
  readonly internalToken?: string;
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
  readonly image_front_small_url?: string;
  readonly image_front_thumb_url?: string;
  readonly image_ingredients_url?: string;
  readonly image_ingredients_small_url?: string;
  readonly image_ingredients_thumb_url?: string;
  readonly image_nutrition_url?: string;
  readonly image_nutrition_small_url?: string;
  readonly image_nutrition_thumb_url?: string;
  readonly image_packaging_url?: string;
  readonly image_packaging_small_url?: string;
  readonly image_packaging_thumb_url?: string;
  readonly image_url?: string;
  readonly quantity?: string;
  readonly product_quantity?: string | number;
  readonly product_quantity_unit?: string;
  readonly serving_quantity?: string | number;
  readonly serving_quantity_unit?: string;
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
  // Highly perishable / fresh foods.
  { match: /meats|fishes|seafood|poultry/, category: "fresh-meat-fish" },
  { match: /fresh-pastas|fresh-doughs/, category: "fresh-milk-pasta" },
  { match: /cheeses|cold-cuts|charcuterie|hams/, category: "cold-cuts-fresh-cheese" },
  { match: /dairies|yogurts|butters|milks/, category: "eggs-dairy" },
  { match: /fruits|vegetables|salads|produce/, category: "produce-fresh" },
  { match: /breads|bakery|viennoiseries/, category: "bakery-fresh" },

  // Shelf-stable categories. These are deliberately more specific than the old
  // generic "PANTRY 30-90 days" fallback.
  { match: /cand(?:y|ies)|candies|confectioner(?:y|ies)|sugar-confectionery|bonbons|caramels|toffees|pastilles|mints|lozenges|caramell|dolciumi|mentine|confiserie/, category: "confectionery-candy" },
  { match: /chewing-gum|chewing gum|bubble-gum|gomme-a-macher|gomme à mâcher/, category: "chewing-gum" },
  { match: /chocolates|chocolate|cocoa-products|cacao/, category: "chocolate-confectionery" },
  { match: /biscuits|cookies|crackers|wafers|sweet-biscuits|savory-biscuits/, category: "biscuits-crackers" },
  { match: /breakfast-cereals|cereals|mueslis|granolas/, category: "breakfast-cereals" },
  { match: /coffee|coffees|tea|teas|infusions/, category: "coffee-tea" },
  { match: /nuts|peanuts|seeds|snacks|chips|crisps|popcorn/, category: "nuts-snacks" },
  { match: /pastas|rices|legumes|pulses|flours|couscous|grains/, category: "dry-staples" },
  { match: /canned|tomato-purees|preserves|pickles|jams|jellies|compotes/, category: "canned-preserved" },
  { match: /sauces|condiments|mustards|mayonnaises|ketchups|dressings/, category: "sauces-condiments" },
  { match: /oils|fats|olive-oils|sunflower-oils/, category: "oils-fats" },
  { match: /water|waters|soft-drinks|sodas|juices|nectars|iced-teas|shelf-stable-beverages/, category: "shelf-stable-beverages" },
  { match: /salts|sugars|honeys|sugar|salt/, category: "pantry-indefinite" },
  { match: /frozen/, category: "frozen-general" },
];

function normalizeOffCategory(
  tags: readonly string[] | undefined,
  productName?: string,
): string | undefined {
  const values = [
    ...(tags ?? []),
    productName ?? "",
  ].map((value) => value.toLowerCase().trim()).filter(Boolean);

  // Prefer explicit OFF taxonomy tags; product name is a fallback for products where
  // categories_tags are absent/incomplete (e.g. many confectionery products).
  for (const value of values) {
    const rule = OFF_CATEGORY_RULES.find((r) => r.match.test(value));
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
export class HttpOffLookupClient implements ExternalBarcodeLookupClient, ExternalProductSearchClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly searchTimeoutMs: number;
  private readonly internalToken: string | undefined;
  private readonly circuitBreakThreshold: number;
  private readonly circuitResetMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  public constructor(options: HttpOffLookupClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 2500;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 8000;
    this.internalToken = options.internalToken;
    this.circuitBreakThreshold = options.circuitBreakThreshold ?? 5;
    this.circuitResetMs = options.circuitResetMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  public async search(input: {
    query: string;
    limit: number;
    traceId: string;
  }): Promise<readonly ExternalProductSearchHit[] | undefined> {
    const normalizedQuery = input.query.trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < 3) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.searchTimeoutMs);
    try {
      const url = new URL(this.baseUrl + "/api/v1/search");
      url.searchParams.set("q", normalizedQuery);
      url.searchParams.set("limit", String(Math.min(Math.max(Math.floor(input.limit), 1), 20)));
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-Trace-Id": input.traceId,
          ...(this.internalToken ? { Authorization: `Bearer ${this.internalToken}` } : {}),
        },
      });
      if (!response.ok) return undefined;

      const body = await response.json() as {
        items?: Array<{ code?: unknown; product?: Record<string, unknown> }>;
      };
      const results: ExternalProductSearchHit[] = [];
      for (const item of body.items ?? []) {
        const product = item.product;
        const code = typeof item.code === "string" ? item.code.trim() : "";
        if (!product || !/^\d{8,14}$/.test(code)) continue;

        const name =
          (typeof product.product_name_it === "string" ? product.product_name_it : "") ||
          (typeof product.product_name === "string" ? product.product_name : "");
        if (!name.trim()) continue;

        const nutriments = isRecord(product.nutriments) ? product.nutriments : {};
        const numberField = (key: string): number | undefined => {
          const value = nutriments[key];
          return typeof value === "number" && Number.isFinite(value) ? value : undefined;
        };
        const categories = Array.isArray(product.categories_tags)
          ? product.categories_tags.filter((v): v is string => typeof v === "string")
          : [];
        const category = normalizeOffCategory(categories, name);
        const brand = typeof product.brands === "string"
          ? product.brands.split(",")[0]?.trim()
          : undefined;
        const photoUrl =
          (typeof product.image_front_url === "string" ? product.image_front_url : undefined) ||
          (typeof product.image_front_small_url === "string" ? product.image_front_small_url : undefined);
        const quantityLabel =
          typeof product.quantity === "string" && product.quantity.trim()
            ? product.quantity.trim()
            : product.product_quantity != null
              ? String(product.product_quantity) + (product.product_quantity_unit ? " " + product.product_quantity_unit : "")
              : undefined;

        const hit: ExternalProductSearchHit = {
          code,
          canonicalName: name.trim(),
          ...(brand ? { brand } : {}),
          ...(photoUrl ? { photoUrl } : {}),
          ...(category ? { category } : {}),
          ...(quantityLabel ? { quantityLabel } : {}),
          ...(numberField("energy-kcal_100g") !== undefined ? { calories: numberField("energy-kcal_100g") } : {}),
          ...(numberField("proteins_100g") !== undefined ? { protein: numberField("proteins_100g") } : {}),
          ...(numberField("carbohydrates_100g") !== undefined ? { carbs: numberField("carbohydrates_100g") } : {}),
          ...(numberField("fat_100g") !== undefined ? { fat: numberField("fat_100g") } : {}),
          ...(numberField("fiber_100g") !== undefined ? { fiber: numberField("fiber_100g") } : {}),
          ...(typeof product.popularity_key === "number" ? { popularityKey: product.popularity_key } : {}),
          ...(typeof product.completeness === "number" ? { completeness: product.completeness } : {}),
        };
        results.push(hit);
      }
      return results;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
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
    name,
  );
  const quantityLabel = typeof p.quantity === "string" && p.quantity.trim()
    ? p.quantity.trim()
    : p.product_quantity != null
      ? String(p.product_quantity) + (p.product_quantity_unit ? " " + p.product_quantity_unit : "")
      : undefined;
  const quantity = parseQuantity(
    p.product_quantity != null ? String(p.product_quantity) : quantityLabel,
    typeof p.product_quantity_unit === "string" ? p.product_quantity_unit : undefined,
  );
  const rawUnit = parseDefaultUnit(
    p.product_quantity_unit
      ? String(p.product_quantity) + " " + p.product_quantity_unit
      : quantityLabel,
  );
  const defaultUnit: ProductUnit = KNOWN_UNITS.includes(rawUnit) ? rawUnit : "piece";
  const rawProduct = Object.fromEntries(Object.entries(p).filter(([key]) => key !== "_cache_meta"));
  const packageUnit = typeof p.product_quantity_unit === "string" && p.product_quantity_unit.trim()
    ? p.product_quantity_unit.trim()
    : rawUnit !== "piece"
      ? rawUnit
      : undefined;
  const servingUnit = typeof p.serving_quantity_unit === "string" && p.serving_quantity_unit.trim()
    ? p.serving_quantity_unit.trim()
    : undefined;
  const servingQuantity = parseSimpleQuantity(p.serving_quantity);
  const servingSize = typeof p.serving_size === "string" && p.serving_size.trim()
    ? p.serving_size.trim()
    : servingQuantity !== undefined && servingUnit
      ? `${servingQuantity} ${servingUnit}`
      : undefined;
  const images = compactImages({
    front: firstString(p.image_front_url, p.image_front_small_url, p.image_front_thumb_url, findSelectedImage(rawProduct, "front")),
    frontSmall: firstString(p.image_front_small_url, findSelectedImage(rawProduct, "front", "200")),
    frontThumb: firstString(p.image_front_thumb_url, findSelectedImage(rawProduct, "front", "100")),
    ingredients: firstString(p.image_ingredients_url, findSelectedImage(rawProduct, "ingredients")),
    ingredientsSmall: firstString(p.image_ingredients_small_url, findSelectedImage(rawProduct, "ingredients", "200")),
    ingredientsThumb: firstString(p.image_ingredients_thumb_url, findSelectedImage(rawProduct, "ingredients", "100")),
    nutrition: firstString(p.image_nutrition_url, findSelectedImage(rawProduct, "nutrition")),
    nutritionSmall: firstString(p.image_nutrition_small_url, findSelectedImage(rawProduct, "nutrition", "200")),
    nutritionThumb: firstString(p.image_nutrition_thumb_url, findSelectedImage(rawProduct, "nutrition", "100")),
    packaging: firstString(p.image_packaging_url, findSelectedImage(rawProduct, "packaging")),
    packagingSmall: firstString(p.image_packaging_small_url, findSelectedImage(rawProduct, "packaging", "200")),
    packagingThumb: firstString(p.image_packaging_thumb_url, findSelectedImage(rawProduct, "packaging", "100")),
  });

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
    ...(quantity !== undefined ? { quantityValue: quantity } : {}),
    ...(quantityLabel ? { quantityLabel } : {}),
    ...(packageUnit ? { quantityUnit: packageUnit } : {}),
    ...(servingSize ? { servingSize } : {}),
    ...(servingQuantity !== undefined ? { servingQuantity } : {}),
    ...(servingUnit ? { servingUnit } : {}),
    ...(images ? { images } : {}),
    ...(category ? { category } : {}),
    openFoodFacts: rawProduct,
    source: "openfoodfacts",
    sourceVersion: body.source === "cache" ? "off-dump-v1" : "off-api-v3",
    sourceRef: body.code,
    confidence: hasNutrients ? 0.85 : 0.6,
  };
}


function parseQuantity(quantity: string | undefined, explicitUnit?: string): number | undefined {
  if (!quantity) return undefined;
  if (explicitUnit) {
    const value = Number(quantity.replace(",", ".").replace(/[^0-9.]/g, ""));
    return Number.isFinite(value) ? value : undefined;
  }
  const matches = [...quantity.replace(",", ".").matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|cl|l)\b/gi)];
  const match = matches.at(-1);
  return match ? Number(match[1]) : undefined;
}

function compactImages(input: Record<string, unknown>): Record<string, string> | undefined {
  const entries = Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}


function parseSimpleQuantity(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const match = /\d+(?:[.,]\d+)?/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function firstString(...values: Array<unknown>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findSelectedImage(product: Record<string, unknown>, kind: string, preferredSize?: string): string | undefined {
  const images = product.images;
  if (!isRecord(images)) return undefined;
  const selected = images.selected;
  if (!isRecord(selected)) return undefined;
  return findUrl(selected[kind], preferredSize);
}

function findUrl(value: unknown, preferredSize?: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const preferred = preferredSize ? value[preferredSize] : undefined;
  if (typeof preferred === "string" && preferred.trim()) return preferred.trim();
  if (isRecord(preferred) && typeof preferred.url === "string") return preferred.url.trim();
  if (typeof value.url === "string" && value.url.trim()) return value.url.trim();
  for (const child of Object.values(value)) {
    const found = findUrl(child, preferredSize);
    if (found) return found;
  }
  return undefined;
}

