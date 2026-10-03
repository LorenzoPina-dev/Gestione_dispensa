import type { Principal } from "../identity/oidc.js";
import type { ProductCandidate } from "./workflow.js";
import {
  CatalogService,
  CatalogValidationError,
  CatalogVersionConflictError,
  type CreateManualProductCommand,
  type IdentifierType,
  type Product,
} from "./service.js";
import { CatalogWorkflowService } from "./workflow.js";

export interface CatalogHttpMeta {
  requestId: string;
  traceId: string;
  schemaVersion: "1.0";
}

export interface CatalogHttpSuccess<T> {
  data: T;
  meta: CatalogHttpMeta;
}

export interface PublicProductSearchHit {
  code: string;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  packageLabel: string | null;
  nutrition: {
    kcalPer100g: number | null;
    proteinGPer100g: number | null;
    carbsGPer100g: number | null;
    fatGPer100g: number | null;
    fiberGPer100g: number | null;
  };
  popularityKey: number | null;
  completeness: number | null;
}

export interface PublicProduct {
  productId: string;
  name: string;
  brand: string | null;
  category: string | null;
  barcodes: string[];
  imageObjectKey: string | null;
  nutrition: {
    kcalPer100g: number | null;
    proteinGPer100g: number | null;
    carbsGPer100g: number | null;
    fatGPer100g: number | null;
    fiberGPer100g: number | null;
  };
  package: {
    value: number | null;
    unit: string | null;
    label: string | null;
  };
  serving: {
    size: string | null;
    quantity: number | null;
    unit: string | null;
  };
  images: {
    front: string | null;
    frontSmall: string | null;
    frontThumb: string | null;
    ingredients: string | null;
    ingredientsSmall: string | null;
    ingredientsThumb: string | null;
    nutrition: string | null;
    nutritionSmall: string | null;
    nutritionThumb: string | null;
    packaging: string | null;
    packagingSmall: string | null;
    packagingThumb: string | null;
  };
  openFoodFacts: Record<string, unknown> | null;
  source: { type: string; id: string };
  version: number;
}

export class CatalogHttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "CatalogHttpError";
  }
}

export class CatalogController {
  private readonly catalog: CatalogService;
  private readonly workflow: CatalogWorkflowService;

  public constructor(catalog: CatalogService, workflow: CatalogWorkflowService) {
    this.catalog = catalog;
    this.workflow = workflow;
  }

  public async searchProducts(
    principal: Principal | undefined,
    query: string,
    limit: number,
    meta: CatalogHttpMeta,
  ): Promise<CatalogHttpSuccess<{ items: PublicProductSearchHit[] }>> {
    if (!principal) throw new CatalogHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const normalized = query.trim().replace(/\s+/g, " ");
    if (normalized.length < 3 || normalized.length > 120) {
      throw new CatalogHttpError(400, "VALIDATION_ERROR", "Search query must contain 3-120 characters.");
    }

    const hits = await this.workflow.searchProducts(normalized, meta.traceId, Math.min(Math.max(limit, 1), 20));
    return success({
      items: hits.map((hit) => ({
        code: hit.code,
        name: hit.canonicalName,
        brand: hit.brand ?? null,
        category: hit.category ?? null,
        imageUrl: hit.photoUrl ?? null,
        packageLabel: hit.quantityLabel ?? null,
        nutrition: {
          kcalPer100g: hit.calories ?? null,
          proteinGPer100g: hit.protein ?? null,
          carbsGPer100g: hit.carbs ?? null,
          fatGPer100g: hit.fat ?? null,
          fiberGPer100g: hit.fiber ?? null,
        },
        popularityKey: hit.popularityKey ?? null,
        completeness: hit.completeness ?? null,
      })),
    }, meta);
  }

  public async getProduct(productId: string, meta: CatalogHttpMeta): Promise<CatalogHttpSuccess<PublicProduct>> {
    const product = await this.catalog.getProduct(productId);
    if (!product) throw new CatalogHttpError(404, "NOT_FOUND", "Product not found.");
    return success(toPublicProduct(product), meta, product.version);
  }

  public async createProduct(
    principal: Principal | undefined,
    command: Omit<CreateManualProductCommand, "actorId">,
    meta: CatalogHttpMeta,
  ): Promise<CatalogHttpSuccess<PublicProduct>> {
    if (!principal) throw new CatalogHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const product = await this.catalog.createManualProduct({ ...command, actorId: principal.subject });
    return success(toPublicProduct(product), meta, product.version, 201);
  }

  public async updateProduct(
    principal: Principal | undefined,
    productId: string,
    expectedVersion: number,
    patch: {
      name?: string;
      brand?: string | null;
      category?: string | null;
      imageObjectKey?: string | null;
      nutrition?: Record<string, unknown> | null;
    },
    meta: CatalogHttpMeta,
  ): Promise<CatalogHttpSuccess<PublicProduct>> {
    if (!principal) throw new CatalogHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    try {
      const product = await this.catalog.updateProduct(
        productId,
        expectedVersion,
        patch,
        principal.subject,
        meta.traceId,
      );
      if (!product) throw new CatalogHttpError(404, "NOT_FOUND", "Product not found.");
      return success(toPublicProduct(product), meta, product.version);
    } catch (error) {
      if (error instanceof CatalogVersionConflictError) {
        throw new CatalogHttpError(412, "PRECONDITION_FAILED", error.message);
      }
      throw error;
    }
  }

  public async lookupBarcode(
    identifierType: IdentifierType,
    value: string,
    meta: CatalogHttpMeta,
    refresh = false,
  ): Promise<CatalogHttpSuccess<{ resolution: "cache" | "provider"; product: PublicProduct }>> {
    const resolution = await this.workflow.resolveBarcode(identifierType, value, meta.traceId, refresh);
    if (resolution.status === "UNKNOWN") {
      throw new CatalogHttpError(404, "NOT_FOUND", "No product was found for this barcode.");
    }
    if (resolution.status === "DEGRADED" || !resolution.product) {
      throw new CatalogHttpError(502, "UPSTREAM_ERROR", "Product lookup provider is unavailable.", true);
    }
    return success(
      { resolution: resolution.resolution, product: toPublicProduct(resolution.product) },
      meta,
      resolution.product.version,
    );
  }

  public async submitImportedCandidate(
    principal: Principal | undefined,
    candidate: Omit<ProductCandidate, "requiresReview">,
    meta: CatalogHttpMeta,
  ): Promise<CatalogHttpSuccess<ProductCandidate>> {
    if (!principal) throw new CatalogHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const result = await this.workflow.submitImportedCandidate(candidate, principal.subject, meta.traceId);
    return success(result, meta);
  }
}

function toPublicProduct(product: Product): PublicProduct {
  return {
    productId: product.id,
    name: product.canonicalName,
    brand: product.brand ?? null,
    category: product.category ?? null,
    barcodes: [...product.barcodes],
    imageObjectKey: product.photoUrl ?? null,
    nutrition: {
      kcalPer100g: product.calories ?? null,
      proteinGPer100g: product.protein ?? null,
      carbsGPer100g: product.carbs ?? null,
      fatGPer100g: product.fat ?? null,
      fiberGPer100g: product.fiber ?? null,
    },
    package: {
      value: product.quantityValue ?? null,
      unit: product.quantityUnit ?? null,
      label: product.quantityLabel ?? null,
    },
    serving: {
      size: product.servingSize ?? null,
      quantity: product.servingQuantity ?? null,
      unit: product.servingUnit ?? null,
    },
    images: {
      front: product.images?.front ?? null,
      frontSmall: product.images?.frontSmall ?? null,
      frontThumb: product.images?.frontThumb ?? null,
      ingredients: product.images?.ingredients ?? null,
      ingredientsSmall: product.images?.ingredientsSmall ?? null,
      ingredientsThumb: product.images?.ingredientsThumb ?? null,
      nutrition: product.images?.nutrition ?? null,
      nutritionSmall: product.images?.nutritionSmall ?? null,
      nutritionThumb: product.images?.nutritionThumb ?? null,
      packaging: product.images?.packaging ?? null,
      packagingSmall: product.images?.packagingSmall ?? null,
      packagingThumb: product.images?.packagingThumb ?? null,
    },
    openFoodFacts: product.openFoodFacts ?? null,
    source: {
      type: product.externalSource ?? "manual",
      id: product.externalRef ?? "manual",
    },
    version: product.version,
  };
}

export function toCatalogHttpError(
  error: unknown,
  meta: CatalogHttpMeta,
): {
  status: number;
  body: { error: { code: string; message: string; retryable: boolean }; meta: CatalogHttpMeta };
} {
  if (error instanceof CatalogHttpError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, retryable: error.retryable }, meta },
    };
  }
  if (error instanceof CatalogValidationError) {
    return {
      status: 422,
      body: { error: { code: error.code, message: "Catalog input is invalid.", retryable: false }, meta },
    };
  }
  return {
    status: 500,
    body: {
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false },
      meta,
    },
  };
}

function success<T>(data: T, meta: CatalogHttpMeta, version?: number, status?: number): CatalogHttpSuccess<T> & { version?: number; status?: number } {
  return { data, meta, ...(version === undefined ? {} : { version }), ...(status === undefined ? {} : { status }) };
}
