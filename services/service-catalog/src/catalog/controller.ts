import type { Principal } from "../identity/oidc.js";
import type { ProductCandidate } from "./workflow.js";
import {
  CatalogService,
  CatalogValidationError,
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

/**
 * The product catalog is shared reference data, not family-scoped, so this
 * controller has no membership/authorization boundary to check beyond
 * authentication: any signed-in user may add a manual product or look up a
 * barcode. Family-scoped consumers of the catalog (e.g. attaching a product
 * to a stock item) enforce their own family authorization separately in the
 * inventory controller.
 */
export class CatalogController {
  private readonly catalog: CatalogService;
  private readonly workflow: CatalogWorkflowService;

  public constructor(catalog: CatalogService, workflow: CatalogWorkflowService) {
    this.catalog = catalog;
    this.workflow = workflow;
  }

  public async listProducts(meta: CatalogHttpMeta): Promise<CatalogHttpSuccess<{ products: Product[] }>> {
    return success({ products: await this.catalog.listProducts() }, meta);
  }

  public async getProduct(productId: string, meta: CatalogHttpMeta): Promise<CatalogHttpSuccess<{ product: Product }>> {
    const product = await this.catalog.getProduct(productId);
    if (product === undefined) throw new CatalogHttpError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Product is not visible.");
    return success({ product }, meta);
  }

  public async createProduct(
    principal: Principal | undefined,
    command: Omit<CreateManualProductCommand, "actorId">,
    meta: CatalogHttpMeta,
  ): Promise<CatalogHttpSuccess<unknown>> {
    if (principal === undefined)
      throw new CatalogHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const product = await this.catalog.createManualProduct({
      ...command,
      actorId: principal.subject,
    });
    return success(product, meta);
  }

  public async lookupBarcode(
    identifierType: IdentifierType,
    value: string,
    meta: CatalogHttpMeta,
  ): Promise<CatalogHttpSuccess<unknown>> {
    const resolution = await this.workflow.resolveBarcode(identifierType, value, meta.traceId);
    return success(resolution, meta);
  }
  /**
   * Backs `POST /api/v1/products/candidates`. Persists an imported candidate
   * (typically from a barcode scan) and marks it `requiresReview` when the
   * confidence is below 0.95 — CatalogWorkflowService owns that threshold.
   */
  public async submitImportedCandidate(
    principal: Principal | undefined,
    candidate: Omit<ProductCandidate, "requiresReview">,
    meta: CatalogHttpMeta,
  ): Promise<CatalogHttpSuccess<ProductCandidate>> {
    if (principal === undefined)
      throw new CatalogHttpError(401, "UNAUTHENTICATED", "Authentication is required.");
    const result = await this.workflow.submitImportedCandidate(
      candidate,
      principal.subject,
      meta.traceId,
    );
    return success(result, meta);
  }
}

export function toCatalogHttpError(
  error: unknown,
  meta: CatalogHttpMeta,
): {
  status: number;
  body: { error: { code: string; message: string; retryable: boolean }; meta: CatalogHttpMeta };
} {
  if (error instanceof CatalogHttpError)
    return {
      status: error.status,
      body: {
        error: { code: error.code, message: error.message, retryable: error.retryable },
        meta,
      },
    };
  if (error instanceof CatalogValidationError)
    return {
      status: 422,
      body: {
        error: { code: error.code, message: "Catalog input is invalid.", retryable: false },
        meta,
      },
    };
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        retryable: false,
      },
      meta,
    },
  };
}

function success<T>(data: T, meta: CatalogHttpMeta): CatalogHttpSuccess<T> {
  return { data, meta };
}
