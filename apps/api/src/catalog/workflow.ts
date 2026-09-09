import {
  normalizeIdentifier,
  type IdentifierType,
  type Product,
  type ProductUnit,
} from "./service.js";

export type BarcodeResolutionStatus = "MATCHED" | "UNKNOWN";

export interface BarcodeResolution {
  status: BarcodeResolutionStatus;
  identifierType: IdentifierType;
  normalizedValue: string;
  product: Product | undefined;
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

  public constructor(lookup: CatalogLookupRepository, candidates: CatalogCandidateRepository) {
    this.lookup = lookup;
    this.candidates = candidates;
  }

  public async resolveBarcode(
    identifierType: IdentifierType,
    value: string,
  ): Promise<BarcodeResolution> {
    const normalizedValue = normalizeIdentifier(identifierType, value);
    const product = await this.lookup.findByIdentifier({ identifierType, normalizedValue });
    return {
      status: product === undefined ? "UNKNOWN" : "MATCHED",
      identifierType,
      normalizedValue,
      product,
    };
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
