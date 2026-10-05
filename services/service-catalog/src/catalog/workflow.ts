import {
  normalizeIdentifier,
  type IdentifierType,
  type Product,
  type ProductUnit,
} from "./service.js";

export type BarcodeResolutionStatus = "MATCHED" | "UNKNOWN" | "DEGRADED";

export interface BarcodeResolution {
  status: BarcodeResolutionStatus;
  resolution: "cache" | "provider";
  identifierType: IdentifierType;
  normalizedValue: string;
  product: Product | undefined;
}

/** A product match coming from an external provider (Open Food Facts today), not yet stored. */
export interface ExternalProductMatch {
  readonly canonicalName: string;
  readonly brand?: string;
  readonly defaultUnit: ProductUnit;
  readonly photoUrl?: string;
  readonly calories?: number;
  readonly protein?: number;
  readonly carbs?: number;
  readonly fat?: number;
  readonly fiber?: number;
  readonly quantityValue?: number;
  readonly quantityUnit?: string;
  readonly quantityLabel?: string;
  readonly servingSize?: string;
  readonly servingQuantity?: number;
  readonly servingUnit?: string;
  readonly images?: {
    front?: string;
    frontSmall?: string;
    frontThumb?: string;
    ingredients?: string;
    ingredientsSmall?: string;
    ingredientsThumb?: string;
    nutrition?: string;
    nutritionSmall?: string;
    nutritionThumb?: string;
    packaging?: string;
    packagingSmall?: string;
    packagingThumb?: string;
  };
  readonly openFoodFacts: Record<string, unknown>;
  readonly sourceRef?: string;
  /** Canonical shelf-life category (see services/inventory/shelf-life-client.ts), when the provider derives one. */
  readonly category?: string;
  readonly source: string;
  readonly sourceVersion: string;
  readonly confidence: number;
}

/**
 * Talks to the off-lookup microservice (services/off-lookup) for barcode resolution.
 * Implementations MUST NEVER throw and MUST NEVER hang indefinitely — every failure mode
 * (network error, timeout, malformed response) must resolve to `undefined` so a barcode
 * lookup degrades gracefully instead of failing the HTTP request.
 * See services/catalog/external-barcode-client.ts.
 */
export interface ExternalProductSearchHit {
  readonly code: string;
  readonly canonicalName: string;
  readonly brand?: string;
  readonly photoUrl?: string;
  readonly category?: string;
  readonly quantityLabel?: string;
  readonly calories?: number;
  readonly protein?: number;
  readonly carbs?: number;
  readonly fat?: number;
  readonly fiber?: number;
  readonly popularityKey?: number;
  readonly completeness?: number;
}

export interface ExternalProductSearchClient {
  search(input: {
    query: string;
    limit: number;
    traceId: string;
  }): Promise<readonly ExternalProductSearchHit[] | undefined>;
}

export interface ExternalBarcodeLookupClient {
  lookup(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
    traceId: string;
  }): Promise<ExternalProductMatch | undefined>;
}

export interface ProductCandidate {
  productId: string | undefined;
  canonicalName: string;
  brand: string | undefined;
  defaultUnit: ProductUnit;
  confidence: number;
  source: string;
  requiresReview: boolean;
}

export interface CatalogLookupRepository {
  findByIdentifier(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
  }): Promise<Product | undefined>;
  /**
   * Stores an external match as a real catalog product AND links the barcode to it via
   * product_identifiers.
   *
   * Existing OpenFoodFacts rows must be reconciled with the latest canonical provider match rather
   * than returned unchanged, otherwise old catalog projections can survive newer off-lookup logic.
   */
  persistExternalMatch(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
    match: ExternalProductMatch;
    traceId: string;
  }): Promise<Product>;
  /** Reconciles an existing OpenFoodFacts product with the latest canonical provider match. */
  refreshExternalMatch(input: {
    identifierType: IdentifierType;
    normalizedValue: string;
    match: ExternalProductMatch;
    traceId: string;
  }): Promise<Product>;
}

export interface CatalogCandidateRepository {
  applyImportedCandidate(input: {
    candidate: ProductCandidate;
    actorId: string;
    traceId: string;
  }): Promise<ProductCandidate>;
}

export class CatalogWorkflowService {
  private readonly lookup: CatalogLookupRepository;
  private readonly candidates: CatalogCandidateRepository;
  private readonly externalLookup: ExternalBarcodeLookupClient | undefined;
  private readonly externalSearch: ExternalProductSearchClient | undefined;

  public constructor(
    lookup: CatalogLookupRepository,
    candidates: CatalogCandidateRepository,
    externalLookup?: ExternalBarcodeLookupClient,
    externalSearch?: ExternalProductSearchClient,
  ) {
    this.lookup = lookup;
    this.candidates = candidates;
    this.externalLookup = externalLookup;
    this.externalSearch = externalSearch;
  }

  public async searchProducts(
    query: string,
    traceId: string,
    limit = 10,
  ): Promise<readonly ExternalProductSearchHit[] | undefined> {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (normalizedQuery.length < 3) return [];
    if (this.externalSearch === undefined) return undefined;

    return this.externalSearch.search({
      query: normalizedQuery,
      limit: Math.min(Math.max(limit, 1), 20),
      traceId,
    });
  }

  /**
   * Local-first, external-fallback barcode resolution:
   *  1. Check our own catalog (fast, free, works offline).
   *  2. Only if unknown locally, ask off-lookup (which itself checks local MongoDB dump first,
   *     then falls back to the live OFF API v3).
   *  3. If the external provider has it, persist it permanently — so this exact barcode is a
   *     local (step 1) hit forever after, and off-lookup is called at most once per product.
   * Provider failures are turned into a DEGRADED result. Persistence failures are deliberately
   * allowed to propagate as internal Catalog errors: the provider may have succeeded, and hiding
   * a database failure as "provider unavailable" makes the API misleading and masks the real fault.
   */
  public async resolveBarcode(
    identifierType: IdentifierType,
    value: string,
    traceId: string,
    refresh = false,
  ): Promise<BarcodeResolution> {
    const normalizedValue = normalizeIdentifier(identifierType, value);

    const local = refresh ? undefined : await this.lookup.findByIdentifier({ identifierType, normalizedValue });
    if (local !== undefined) {
      // Manual products are authoritative and remain fully local/offline.
      // External products are a projection of off-lookup's canonical OFF contract. Reconcile only
      // clearly incomplete snapshots so legacy rows cannot keep serving stale derived fields.
      if (
        this.externalLookup === undefined ||
        local.externalSource?.trim().toLowerCase() !== "openfoodfacts" ||
        !needsExternalReconciliation(local)
      ) {
        return { status: "MATCHED", resolution: "cache", identifierType, normalizedValue, product: local };
      }

      try {
        const match = await this.externalLookup.lookup({ identifierType, normalizedValue, traceId });
        if (match === undefined) {
          // Provider unavailable or product no longer exists: preserve the last known Catalog copy.
          return { status: "MATCHED", resolution: "cache", identifierType, normalizedValue, product: local };
        }
        const product = await this.lookup.refreshExternalMatch({
          identifierType,
          normalizedValue,
          match,
          traceId,
        });
        return {
          status: "MATCHED",
          resolution: externalResolution(match),
          identifierType,
          normalizedValue,
          product,
        };
      } catch (error) {
        logBarcodeFailure("barcode_cache_reconciliation_failed", error, {
          identifierType,
          normalizedValue,
          traceId,
        });
        throw error;
      }
    }

    if (this.externalLookup === undefined) {
      return { status: "UNKNOWN", resolution: "provider", identifierType, normalizedValue, product: undefined };
    }

    let match: ExternalProductMatch | undefined;
    try {
      match = await this.externalLookup.lookup({ identifierType, normalizedValue, traceId });
    } catch (error) {
      logBarcodeFailure("barcode_provider_failed", error, {
        identifierType,
        normalizedValue,
        traceId,
      });
      return { status: "DEGRADED", resolution: "provider", identifierType, normalizedValue, product: undefined };
    }

    if (match === undefined) {
      return { status: "UNKNOWN", resolution: "provider", identifierType, normalizedValue, product: undefined };
    }

    try {
      const product = await this.lookup.persistExternalMatch({
        identifierType,
        normalizedValue,
        match,
        traceId,
      });
      return { status: "MATCHED", resolution: "provider", identifierType, normalizedValue, product };
    } catch (error) {
      logBarcodeFailure("barcode_persistence_failed", error, {
        identifierType,
        normalizedValue,
        traceId,
      });
      throw error;
    }
  }

  public async submitImportedCandidate(
    candidate: Omit<ProductCandidate, "requiresReview">,
    actorId: string,
    traceId: string,
  ): Promise<ProductCandidate> {
    if (candidate.confidence < 0 || candidate.confidence > 1)
      throw new Error("Candidate confidence must be between 0 and 1.");
    const normalized = { ...candidate, requiresReview: candidate.confidence < 0.95 };
    return this.candidates.applyImportedCandidate({ candidate: normalized, actorId, traceId });
  }
}


function needsExternalReconciliation(product: Product): boolean {
  if (product.externalSource?.trim().toLowerCase() !== "openfoodfacts") return false;

  const hasImage = product.images
    ? Object.values(product.images).some((value) => typeof value === "string" && value.trim().length > 0)
    : false;
  const hasCoreNutrition = [product.calories, product.protein, product.carbs, product.fat]
    .some((value) => value !== undefined);
  // The stale rows produced by the previous mapper had the raw OFF document but neither
  // materialized images nor core nutrition. Do not treat an optional package/serving field as
  // evidence of staleness: those fields can legitimately be absent in OFF.
  const hasRawSnapshot = product.openFoodFacts !== undefined;
  // This checks only the Catalog projection. Raw OFF interpretation stays inside off-lookup.
  return hasRawSnapshot && !hasImage && !hasCoreNutrition;
}

function externalResolution(match: ExternalProductMatch): "cache" | "provider" {
  return match.sourceVersion.includes("-cache") ? "cache" : "provider";
}

function logBarcodeFailure(
  event: "barcode_provider_failed" | "barcode_persistence_failed",
  error: unknown,
  context: {
    identifierType: IdentifierType;
    normalizedValue: string;
    traceId: string;
  },
): void {
  const details = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { error: String(error) };

  console.error(JSON.stringify({
    service: "service-catalog",
    event,
    ...context,
    ...details,
  }));
}
