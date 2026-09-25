import { Router } from "express";
import { InventoryController, toInventoryHttpError } from "../../inventory/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { asyncHandler, methodNotAllowed, requireIfMatchHeader, resolvePrincipal } from "../middleware.js";
import { parseCreateStockItemBody, parseRecordMovementBody } from "../validators.js";
import { CreateStockItemCommand } from "../../inventory/service.js";

export interface InventoryRouteDependencies {
  controller: InventoryController;
  verifier: OidcTokenVerifier;
}

/**
 * The inventory domain HTTP surface: list/create stock items, fetch one, and record/list
 * movements. `stock-items` is kept as a path alias of `items` for backward compatibility with
 * earlier client builds (`:kind(items|stock-items)` matches either segment).
 */
export function buildInventoryRouter(deps: InventoryRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  router
    .route("/inventory/:kind(items|stock-items)")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const familyId = req.query.familyId;
        if (typeof familyId !== "string" || familyId.trim().length === 0) {
          sendFailure(res, 400, "VALIDATION_ERROR", "Query parameter familyId is required.", req.meta);
          return;
        }
        const status = req.query.status;
        if (status !== undefined && status !== "ACTIVE" && status !== "DEPLETED") {
          sendFailure(res, 400, "VALIDATION_ERROR", "status must be ACTIVE or DEPLETED.", req.meta);
          return;
        }
        // status=DEPLETED backs the shopping list's "prodotti finiti" picker (see
        // InventoryController.listDepletedStockItems); the default (omitted, or ACTIVE) is the
        // ordinary pantry view.
        const result =
          status === "DEPLETED"
            ? controller.listDepletedStockItems(principal, familyId, req.meta)
            : controller.listStockItems(principal, familyId, req.meta);
        await respond(res, req.meta, result, toInventoryHttpError);
      }),
    )
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const parsed = parseCreateStockItemBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.createStockItem(principal, {
            ...parsed,
            ...(parsed.expiresAt ? { expiresAt: new Date(parsed.expiresAt) } : {}),
            traceId: req.meta.traceId,
          } as Omit<CreateStockItemCommand, "actorId">, req.meta),
          toInventoryHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/inventory/:kind(items|stock-items)/:stockItemId")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.getStockItem(principal, req.params.stockItemId as string, req.meta),
          toInventoryHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/inventory/:kind(items|stock-items)/:stockItemId/movements")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.listMovements(principal, req.params.stockItemId as string, req.meta),
          toInventoryHttpError,
        );
      }),
    )
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const ifMatch = requireIfMatchHeader(req, res);
        if (ifMatch === undefined) return;
        const parsed = parseRecordMovementBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.recordMovement(
            principal,
            { ...parsed, stockItemId: req.params.stockItemId as string, traceId: req.meta.traceId },
            ifMatch,
            req.meta,
          ),
          toInventoryHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
