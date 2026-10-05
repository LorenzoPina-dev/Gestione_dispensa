import type { IdentifierType, ProductUnit } from "./service.js";
import type {
  ExternalBarcodeLookupClient,
  ExternalProductMatch,
  ExternalProductSearchClient,
  ExternalProductSearchHit,
} from "./workflow.js";

export interface HttpOffLookupClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly searchTimeoutMs?: number;
  readonly internalToken?: string;
  readonly circuitBreakThreshold?: number;
  readonly circuitResetMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/**
 * Canonical contract exposed by off-lookup.
 *
 * service-catalog intentionally does not interpret Open Food Facts fields, image metadata,
 * selected_images, dump-specific fields, or API-version differences. All of that belongs to
 * off-lookup. These are application-level fields only.
 */
interface CanonicalProduct {
  readonly code?: string;
  readonly name?: string | null;
  readonly brand?: string | null;
  readonly category?: string | null;
  readonly quantity?: { value?: number | null; unit?: string | null; label?: string | null };
  readonly serving?: { quantity?: number | null; unit?: string | null; label?: string | null };
  readonly images?: {
    front?: CanonicalImage;
    ingredients?: CanonicalImage;
    nutrition?: CanonicalImage;
    packaging?: CanonicalImage;
  };
  readonly nutrition?: Record<string, unknown>;
  readonly openFoodFacts?: Record<string, unknown>;
}
interface CanonicalImage {
  readonly url?: string | null;
  readonly small?: string | null;
  readonly thumb?: string | null;
}
interface OffLookupHitBody {
  readonly code: string;
  readonly source: "cache" | "live-api";
  readonly product: CanonicalProduct;
}

const KNOWN_UNITS: readonly ProductUnit[] = ["g", "kg", "ml", "l", "piece", "pack"];

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
        items?: Array<{ code?: unknown; product?: CanonicalProduct }>;
      };
      const results: ExternalProductSearchHit[] = [];
      for (const item of body.items ?? []) {
        const product = item.product;
        const code = typeof item.code === "string" ? item.code.trim() : "";
        if (!product || !/^\d{6,14}$/.test(code)) continue;
        const hit = toExternalSearchHit(code, product);
        if (hit) results.push(hit);
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
    if (this.now() < this.circuitOpenUntil) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}/api/v1/products/${encodeURIComponent(input.normalizedValue)}`;
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (response.status === 404) {
        this.recordSuccess();
        return undefined;
      }
      if (response.status === 503) {
        this.recordFailure();
        return undefined;
      }
      if (!response.ok) {
        this.recordFailure();
        return undefined;
      }

      const body = await response.json() as OffLookupHitBody;
      this.recordSuccess();
      return toExternalMatch(body);
    } catch {
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

function toExternalSearchHit(code: string, product: CanonicalProduct): ExternalProductSearchHit | undefined {
  const name = text(product.name);
  if (!name) return undefined;
  const nutrition = product.nutrition ?? {};
  const number = (key: string): number | undefined => {
    const value = nutrition[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const image = product.images?.front;
  return {
    code,
    canonicalName: name,
    ...(text(product.brand) ? { brand: text(product.brand) } : {}),
    ...(imageUrl(image) ? { photoUrl: imageUrl(image) } : {}),
    ...(text(product.category) ? { category: text(product.category) } : {}),
    ...(text(product.quantity?.label) ? { quantityLabel: text(product.quantity?.label) } : {}),
    ...(number("energy-kcal_100g") !== undefined ? { calories: number("energy-kcal_100g") } : {}),
    ...(number("proteins_100g") !== undefined ? { protein: number("proteins_100g") } : {}),
    ...(number("carbohydrates_100g") !== undefined ? { carbs: number("carbohydrates_100g") } : {}),
    ...(number("fat_100g") !== undefined ? { fat: number("fat_100g") } : {}),
    ...(number("fiber_100g") !== undefined ? { fiber: number("fiber_100g") } : {}),
    ...(typeof product.openFoodFacts?.popularity_key === "number" ? { popularityKey: product.openFoodFacts.popularity_key } : {}),
    ...(typeof product.openFoodFacts?.completeness === "number" ? { completeness: product.openFoodFacts.completeness } : {}),
  };
}

function toExternalMatch(body: OffLookupHitBody): ExternalProductMatch | undefined {
  const p = body.product;
  const name = text(p.name);
  if (!name) return undefined;

  const nutrition = p.nutrition ?? {};
  const number = (key: string): number | undefined => {
    const value = nutrition[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const calories = number("energy-kcal_100g");
  const protein = number("proteins_100g");
  const carbs = number("carbohydrates_100g");
  const fat = number("fat_100g");
  const fiber = number("fiber_100g");
  const hasNutrients = [calories, protein, carbs, fat].some((v) => v !== undefined);
  const quantity = p.quantity?.value ?? undefined;
  const quantityUnit = normalizeUnit(p.quantity?.unit);
  const servingQuantity = p.serving?.quantity ?? undefined;
  const servingUnit = normalizeUnit(p.serving?.unit);
  const images = compactImages({
    front: imageUrl(p.images?.front),
    frontSmall: imageSmall(p.images?.front),
    frontThumb: imageThumb(p.images?.front),
    ingredients: imageUrl(p.images?.ingredients),
    ingredientsSmall: imageSmall(p.images?.ingredients),
    ingredientsThumb: imageThumb(p.images?.ingredients),
    nutrition: imageUrl(p.images?.nutrition),
    nutritionSmall: imageSmall(p.images?.nutrition),
    nutritionThumb: imageThumb(p.images?.nutrition),
    packaging: imageUrl(p.images?.packaging),
    packagingSmall: imageSmall(p.images?.packaging),
    packagingThumb: imageThumb(p.images?.packaging),
  });

  return {
    canonicalName: name,
    ...(text(p.brand) ? { brand: text(p.brand) } : {}),
    defaultUnit: quantityUnit ?? "piece",
    ...(imageUrl(p.images?.front) ? { photoUrl: imageUrl(p.images?.front) } : {}),
    ...(calories !== undefined ? { calories } : {}),
    ...(protein !== undefined ? { protein } : {}),
    ...(carbs !== undefined ? { carbs } : {}),
    ...(fat !== undefined ? { fat } : {}),
    ...(fiber !== undefined ? { fiber } : {}),
    ...(quantity !== undefined ? { quantityValue: quantity } : {}),
    ...(text(p.quantity?.label) ? { quantityLabel: text(p.quantity?.label) } : {}),
    ...(quantityUnit ? { quantityUnit } : {}),
    ...(text(p.serving?.label) ? { servingSize: text(p.serving?.label) } : {}),
    ...(servingQuantity !== undefined ? { servingQuantity } : {}),
    ...(servingUnit ? { servingUnit } : {}),
    ...(images ? { images } : {}),
    ...(text(p.category) ? { category: text(p.category) } : {}),
    openFoodFacts: p.openFoodFacts ?? {},
    source: "openfoodfacts",
    sourceVersion: body.source === "cache" ? "off-canonical-v1-cache" : "off-canonical-v1-live",
    sourceRef: body.code,
    confidence: hasNutrients ? 0.85 : 0.6,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function imageUrl(image: CanonicalImage | undefined): string | undefined {
  return text(image?.url);
}
function imageSmall(image: CanonicalImage | undefined): string | undefined {
  return text(image?.small);
}
function imageThumb(image: CanonicalImage | undefined): string | undefined {
  return text(image?.thumb);
}
function compactImages(input: Record<string, unknown>): Record<string, string> | undefined {
  const entries = Object.entries(input).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
function normalizeUnit(value: unknown): ProductUnit | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return (KNOWN_UNITS as readonly string[]).includes(normalized)
    ? normalized as ProductUnit
    : undefined;
}
