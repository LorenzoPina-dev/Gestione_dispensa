import { Router } from "express";
import { CatalogController, toCatalogHttpError } from "../../catalog/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { asyncHandler, methodNotAllowed, resolvePrincipal } from "../middleware.js";
import { IDENTIFIER_TYPES, parseCreateProductBody, parseResolveBarcodeBody, parseSubmitCandidateBody, } from "../validators.js";
import type { IdentifierType } from "../../catalog/service.js";
import { ProductCandidate } from "../../catalog/workflow.js";

export interface CatalogRouteDependencies {
  controller: CatalogController;
  verifier: OidcTokenVerifier;
}

/**
 * Catalog data is shared reference data, not family-scoped: listing/reading and barcode lookup
 * are public, only creating a manual product requires authentication.
 */
export function buildCatalogRouter(deps: CatalogRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  const listProducts = asyncHandler(async (req, res) => {
    await respond(res, req.meta, controller.listProducts(req.meta), toCatalogHttpError);
  });
  const createProduct = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const parsed = parseCreateProductBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.createProduct(principal, { ...parsed, traceId: req.meta.traceId }, req.meta),
      toCatalogHttpError,
    );
  });

   const submitCandidate = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const parsed = parseSubmitCandidateBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.submitImportedCandidate(principal, parsed as Omit<ProductCandidate, "requiresReview">, req.meta),
      toCatalogHttpError,
    );
  });
  router.route("/products/candidates").post(submitCandidate).all(methodNotAllowed);
  router.route("/catalog/candidates").post(submitCandidate).all(methodNotAllowed);

  // Registered before "/products/:productId" so "resolve-barcode" isn't swallowed as a product id.
  router
    .route("/products/resolve-barcode")
    .post(
      asyncHandler(async (req, res) => {
        const parsed = parseResolveBarcodeBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "identifierType and value are required.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.lookupBarcode(parsed.identifierType, parsed.value, req.meta),
          toCatalogHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router.route("/products").get(listProducts).post(createProduct).all(methodNotAllowed);
  router.route("/catalog/products").get(listProducts).post(createProduct).all(methodNotAllowed);

  router
    .route("/products/:productId")
    .get(
      asyncHandler(async (req, res) => {
        await respond(res, req.meta, controller.getProduct(req.params.productId as string, req.meta), toCatalogHttpError);
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/catalog/lookup")
    .get(
      asyncHandler(async (req, res) => {
        const identifierType = req.query.identifierType;
        const value = req.query.value;
        if (
          typeof identifierType !== "string" ||
          !IDENTIFIER_TYPES.includes(identifierType as IdentifierType) ||
          typeof value !== "string" ||
          value.trim().length === 0
        ) {
          sendFailure(res, 400, "VALIDATION_ERROR", "Query parameters identifierType and value are required.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.lookupBarcode(identifierType as IdentifierType, value, req.meta),
          toCatalogHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
