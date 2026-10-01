import { Router } from "express";
import { CatalogController, toCatalogHttpError } from "../../catalog/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import {
  respond,
  sendFailure,
} from "../envelope.js";
import {
  asyncHandler,
  methodNotAllowed,
  requireIdempotencyKey,
  requireIfMatchVersion,
  resolvePrincipal,
} from "../middleware.js";
import {
  parseCreateProductBody,
  parsePatchProductBody,
  parseResolveBarcodeBody,
} from "../validators.js";

export interface CatalogRouteDependencies {
  controller: CatalogController;
  verifier: OidcTokenVerifier;
}

/**
 * Canonical public Catalog surface.
 * Only routes documented in docs/API.md / docs/openapi.yaml are exposed here.
 */
export function buildCatalogRouter(deps: CatalogRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  router
    .route("/catalog/products")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const idempotencyKey = requireIdempotencyKey(req, res);
        if (!idempotencyKey) return;

        const parsed = parseCreateProductBody(req.body);
        if (!parsed) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }

        await respond(
          res,
          req.meta,
          controller.createProduct(
            principal,
            {
              ...parsed,
              traceId: req.meta.traceId,
            },
            req.meta,
          ),
          toCatalogHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/catalog/products/:productId")
    .get(
      asyncHandler(async (req, res) => {
        await respond(
          res,
          req.meta,
          controller.getProduct(req.params.productId as string, req.meta),
          toCatalogHttpError,
        );
      }),
    )
    .patch(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const idempotencyKey = requireIdempotencyKey(req, res);
        if (!idempotencyKey) return;
        const expectedVersion = requireIfMatchVersion(req, res);
        if (expectedVersion === undefined) return;

        const parsed = parsePatchProductBody(req.body);
        if (!parsed) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }

        await respond(
          res,
          req.meta,
          controller.updateProduct(
            principal,
            req.params.productId as string,
            expectedVersion,
            parsed,
            req.meta,
          ),
          toCatalogHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/catalog/barcodes/:barcode")
    .get(
      asyncHandler(async (req, res) => {
        const barcode = req.params.barcode as string;
        if (!/^[0-9]+$/.test(barcode)) {
          sendFailure(res, 400, "VALIDATION_ERROR", "barcode must contain digits only.", req.meta);
          return;
        }

        const refresh = req.query.refresh === "true";
        await respond(
          res,
          req.meta,
          controller.lookupBarcode("BARCODE", barcode, req.meta, refresh),
          toCatalogHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/catalog/barcodes/resolve")
    .post(
      asyncHandler(async (req, res) => {
        const idempotencyKey = requireIdempotencyKey(req, res);
        if (!idempotencyKey) return;

        const parsed = parseResolveBarcodeBody(req.body);
        if (!parsed) {
          sendFailure(res, 400, "VALIDATION_ERROR", "barcode is required.", req.meta);
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

  return router;
}
