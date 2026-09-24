import {
  normalizeIdentifier,
  type IdentifierType,
  type Product,
  type ProductUnit,
} from "./service.js";

export type BarcodeResolutionStatus = "MATCHED" | "UNKNOWN" | "DEGRADED";

export interface BarcodeResolution {
  status: BarcodeResolutionStatus;
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
  readonly source: string;
  readonly sourceVersion: string;
  readonly confidence: number;
}

/**
 * Talks to the external worker-integrations service. Implementations MUST NEVER throw and MUST
 * NEVER hang indefinitely -- every failure mode (network error, timeout, malformed response)
 * should resolve to `undefined` so a barcode lookup can always degrade gracefully instead of
 * failing the whole HTTP request. See apps/api/src/catalog/external-barcode-client.ts.
 */
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
   * product_identifiers, so every subsequent lookup of the same barcode is served from
   * `findByIdentifier` above and never needs to call the external provider again.
   */
  persistExternalMatch(input: {
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

  public constructor(
    lookup: CatalogLookupRepository,
    candidates: CatalogCandidateRepository,
    externalLookup?: ExternalBarcodeLookupClient,
  ) {
    this.lookup = lookup;
    this.candidates = candidates;
    this.externalLookup = externalLookup;
  }

  /**
   * Local-first, external-fallback barcode resolution:
   *  1. Check our own catalog (fast, free, works offline).
   *  2. Only if unknown locally, ask the external worker (Open Food Facts) for it.
   *  3. If the external provider has it, persist it permanently -- so this exact barcode is a
   *     local (step 1) hit forever after, and the external API is called at most once per product.
   * Every external-path failure is caught here and turned into a DEGRADED result: a third-party
   * outage or a bug in the enrichment path must never surface as a 500 to someone scanning a
   * barcode -- it should just fall back to manual entry.
   */
  public async resolveBarcode(
  identifierType: IdentifierType,
  value: string,
  traceId: string,
): Promise<BarcodeResolution> {
  const normalizedValue = normalizeIdentifier(identifierType, value);
  console.log("[catalog] resolveBarcode START", { identifierType, normalizedValue, traceId });

  const local = await this.lookup.findByIdentifier({ identifierType, normalizedValue });
  console.log("[catalog] local lookup:", local ? `HIT ${local.id}` : "miss");

  if (local !== undefined) {
    return { status: "MATCHED", identifierType, normalizedValue, product: local };
  }

  if (this.externalLookup === undefined) {
    console.log("[catalog] externalLookup NOT configured (undefined)");
    return { status: "UNKNOWN", identifierType, normalizedValue, product: undefined };
  }

  try {
    console.log("[catalog] calling externalLookup...");
    const match = await this.externalLookup.lookup({ identifierType, normalizedValue, traceId });
    console.log("[catalog] externalLookup returned:", match ? `MATCH name=${match.canonicalName}` : "undefined");

    if (match === undefined) {
      console.log("[catalog] external match is undefined → UNKNOWN");
      return { status: "UNKNOWN", identifierType, normalizedValue, product: undefined };
    }

    console.log("[catalog] calling persistExternalMatch...");
    const product = await this.lookup.persistExternalMatch({
      identifierType,
      normalizedValue,
      match,
      traceId,
    });
    console.log("[catalog] persistExternalMatch OK, productId =", product.id);
    return { status: "MATCHED", identifierType, normalizedValue, product };
  } catch (error) {
    console.error("[catalog] persistExternalMatch failed", {
      identifierType,
      normalizedValue,
      traceId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return { status: "DEGRADED", identifierType, normalizedValue, product: undefined };
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
