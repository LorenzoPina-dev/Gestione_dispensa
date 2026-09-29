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
        // ordinary pantry view, which additionally accepts pagination/search/filter/sort query
        // params (see ListStockItemsQuery / migration 0017_pantry-optimization-and-new-features.sql).
        // Every one of these is optional -- a request with only `familyId` behaves exactly as
        // before, just with the response's `data` gaining `page`/`pageSize`/`total` alongside the
        // pre-existing `items` array.
        if (status === "DEPLETED") {
          await respond(res, req.meta, controller.listDepletedStockItems(principal, familyId, req.meta), toInventoryHttpError);
          return;
        }
        const rawPage = req.query.page;
        const rawPageSize = req.query.pageSize;
        const page = typeof rawPage === "string" && rawPage.trim() !== "" ? Number(rawPage) : undefined;
        const pageSize =
          typeof rawPageSize === "string" && rawPageSize.trim() !== "" ? Number(rawPageSize) : undefined;
        if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
          sendFailure(res, 400, "VALIDATION_ERROR", "page must be a positive integer.", req.meta);
          return;
        }
        if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) {
          sendFailure(res, 400, "VALIDATION_ERROR", "pageSize must be a positive integer.", req.meta);
          return;
        }
        const search = typeof req.query.search === "string" ? req.query.search : undefined;
        const locationId = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
        const sortByRaw = req.query.sortBy;
        if (sortByRaw !== undefined && sortByRaw !== "updatedAt" && sortByRaw !== "expiry" && sortByRaw !== "name") {
          sendFailure(res, 400, "VALIDATION_ERROR", "sortBy must be updatedAt, expiry or name.", req.meta);
          return;
        }
        const sortDirRaw = req.query.sortDir;
        if (sortDirRaw !== undefined && sortDirRaw !== "ASC" && sortDirRaw !== "DESC") {
          sendFailure(res, 400, "VALIDATION_ERROR", "sortDir must be ASC or DESC.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.listStockItems(principal, familyId, req.meta, {
            page,
            pageSize,
            search,
            locationId,
            sortBy: sortByRaw,
            sortDir: sortDirRaw,
          }),
          toInventoryHttpError,
        );
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
        const expectedVersionHeader = req.header("If-Match");
        const expectedVersion = expectedVersionHeader
          ? Number(expectedVersionHeader.replace(/"/g, ""))
          : req.body.expectedVersion;
        await respond(
          res,
          req.meta,
          controller.recordMovement(
            principal,
            { ...parsed, stockItemId: req.params.stockItemId as string, traceId: req.meta.traceId, expectedVersion },
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
