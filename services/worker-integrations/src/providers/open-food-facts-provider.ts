import {
  BarcodeProviderError,
  type BarcodeProvider,
  type BarcodeProviderContext,
  type BarcodeProviderResponse,
} from "../barcode.js";

export interface OpenFoodFactsProviderOptions {
  /** Overridable for tests and self-hosted mirrors. Defaults to the public OFF instance. */
  readonly baseUrl?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

type ProductUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";

interface OffNutriments {
  readonly "energy-kcal_100g"?: number;
  readonly proteins_100g?: number;
  readonly carbohydrates_100g?: number;
  readonly fat_100g?: number;
  readonly fiber_100g?: number;
}

interface OffProductPayload {
  readonly product_name?: string;
  readonly product_name_it?: string;
  readonly brands?: string;
  readonly image_front_url?: string;
  readonly image_url?: string;
  readonly quantity?: string;
  readonly nutriments?: OffNutriments;
  readonly nutrition_data_per?: string;
}

interface OffApiResponse {
  readonly status?: number;
  readonly product?: OffProductPayload;
}

const REQUESTED_FIELDS = [
  "product_name",
  "product_name_it",
  "brands",
  "image_front_url",
  "image_url",
  "quantity",
  "nutriments",
  "nutrition_data_per",
].join(",");

/**
 * Concrete BarcodeProvider backed by the public Open Food Facts database
 * (https://world.openfoodfacts.org). No API key is required.
 *
 * Every failure mode — network error, timeout, rate limiting, malformed payload — is converted
 * into a typed BarcodeProviderError rather than a bare Error or a thrown exception, so
 * BarcodeCatalogAdapter (the caller) can always degrade gracefully instead of the process
 * crashing or an unhandled rejection escaping.
 */
export class OpenFoodFactsProvider implements BarcodeProvider {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: OpenFoodFactsProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://world.openfoodfacts.org").replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? "GestioneDispensa/0.1 (+https://github.com/, family-local)";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async lookup(
    identifier: string,
    context: BarcodeProviderContext,
  ): Promise<BarcodeProviderResponse> {
    const response = await this.fetchProduct(identifier, context);

    if (response.status === 429) {
      throw new BarcodeProviderError(
        "PROVIDER_RATE_LIMITED",
        "Open Food Facts rate limit exceeded.",
        true,
      );
    }
    if (!response.ok) {
      throw new BarcodeProviderError(
        "PROVIDER_UNAVAILABLE",
        `Open Food Facts responded with HTTP ${response.status}.`,
        response.status >= 500,
      );
    }

    const body = await this.parseBody(response);
    return this.toProviderResponse(identifier, body);
  }

  private async fetchProduct(identifier: string, context: BarcodeProviderContext): Promise<Response> {
    try {
      return await this.fetchImpl(
        `${this.baseUrl}/api/v2/product/${encodeURIComponent(identifier)}.json?fields=${REQUESTED_FIELDS}`,
        {
          signal: context.signal,
          headers: { "User-Agent": this.userAgent, Accept: "application/json" },
        },
      );
    } catch (error) {
      if (context.signal.aborted) {
        throw new BarcodeProviderError(
          "PROVIDER_TIMEOUT",
          "Open Food Facts request exceeded its deadline.",
          true,
        );
      }
      throw new BarcodeProviderError(
        "PROVIDER_UNAVAILABLE",
        `Open Food Facts request failed: ${error instanceof Error ? error.message : "network error"}.`,
        true,
      );
    }
  }

  private async parseBody(response: Response): Promise<OffApiResponse> {
    try {
      return (await response.json()) as OffApiResponse;
    } catch {
      throw new BarcodeProviderError(
        "PROVIDER_UNAVAILABLE",
        "Open Food Facts returned a response that could not be parsed.",
        true,
      );
    }
  }

  private toProviderResponse(identifier: string, body: OffApiResponse): BarcodeProviderResponse {
    const observedAt = new Date().toISOString();
    const base = {
      provider: "openfoodfacts",
      providerRequestId: identifier,
      sourceVersion: "off-api-v2",
      observedAt,
    } as const;

    if (body.status !== 1 || body.product === undefined) {
      // A genuine "this barcode is not in Open Food Facts" is not an error: the adapter treats a
      // response with no `product` as NOT_FOUND and routes the person to manual entry.
      return { ...base, quality: "UNKNOWN", confidence: 0, warnings: [] };
    }

    const name = (body.product.product_name_it ?? body.product.product_name ?? "").trim();
    if (name.length === 0) {
      return { ...base, quality: "UNKNOWN", confidence: 0, warnings: ["missing_name"] };
    }

    const nutriments = body.product.nutriments ?? {};
    const isPer100 = (body.product.nutrition_data_per ?? "100g") === "100g";
    const warnings: string[] = isPer100 ? [] : ["nutrition_not_per_100g"];
    const nutrientValue = (value: number | undefined): number | undefined =>
      isPer100 && typeof value === "number" && Number.isFinite(value) ? value : undefined;

    const calories = nutrientValue(nutriments["energy-kcal_100g"]);
    const protein = nutrientValue(nutriments.proteins_100g);
    const carbs = nutrientValue(nutriments.carbohydrates_100g);
    const fat = nutrientValue(nutriments.fat_100g);
    const fiber = nutrientValue(nutriments.fiber_100g);
    const hasNutrients = [calories, protein, carbs, fat].some((value) => value !== undefined);
    const brand = body.product.brands?.split(",")[0]?.trim();
    const photoUrl = body.product.image_front_url ?? body.product.image_url;

    return {
      ...base,
      quality: hasNutrients ? "IMPORTED" : "ESTIMATED",
      confidence: hasNutrients ? 0.85 : 0.6,
      warnings,
      product: {
        canonicalName: name,
        ...(brand ? { brand } : {}),
        defaultUnit: parseDefaultUnit(body.product.quantity),
        ...(photoUrl ? { photoUrl } : {}),
        ...(calories !== undefined ? { calories } : {}),
        ...(protein !== undefined ? { protein } : {}),
        ...(carbs !== undefined ? { carbs } : {}),
        ...(fat !== undefined ? { fat } : {}),
        ...(fiber !== undefined ? { fiber } : {}),
      },
    };
  }
}

/** Best-effort guess from OFF's free-text "quantity" field (e.g. "500 g", "1 l", "6 x 33cl"). */
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
