import { Router } from "express";
import { ShoppingController, toShoppingHttpError } from "../../shopping/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { asyncHandler, methodNotAllowed, requireIfMatchVersion, resolvePrincipal } from "../middleware.js";
import {
  parseAddShoppingItemBody,
  parseBatchActionBody,
  parseCreateShoppingListBody,
  parseUpdateShoppingItemBody,
} from "../validators.js";

export interface ShoppingRouteDependencies {
  controller: ShoppingController;
  verifier: OidcTokenVerifier;
}

function requireFamilyId(body: Record<string, unknown>): string | undefined {
  const familyId = body.familyId;
  return typeof familyId === "string" && familyId.length > 0 ? familyId : undefined;
}

/**
 * The shopping domain HTTP surface. `/shopping/lists/...` is kept as a path alias of
 * `/shopping-lists/...` for item/batch mutation routes (both are used by earlier client
 * builds); single-list GET and archive only ever shipped under `/shopping-lists`.
 *
 * Route order matters here: literal segments (`active`, `:listId/archive`, `:listId/items`,
 * `:listId/batch-action`) are registered before the bare `/shopping-lists/:listId` GET, or
 * Express would match e.g. `active` as a `:listId` value.
 */
export function buildShoppingRouter(deps: ShoppingRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  const getActiveList = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const familyId = req.query.familyId;
    if (typeof familyId !== "string" || familyId.trim().length === 0) {
      sendFailure(res, 400, "VALIDATION_ERROR", "Query parameter familyId is required.", req.meta);
      return;
    }
    await respond(res, req.meta, controller.getActiveList(principal, familyId, req.meta), toShoppingHttpError);
  });
  router.route("/shopping-lists/active").get(getActiveList).all(methodNotAllowed);
  router.route("/shopping/lists/active").get(getActiveList).all(methodNotAllowed);

  const createList = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const parsed = parseCreateShoppingListBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.createList(principal, { ...parsed, traceId: req.meta.traceId }, req.meta),
      toShoppingHttpError,
    );
  });
  router.route("/shopping-lists").post(createList).all(methodNotAllowed);
  router.route("/shopping/lists").post(createList).all(methodNotAllowed);

  router
    .route("/shopping-lists/:listId/archive")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const expectedVersion = requireIfMatchVersion(req, res);
        if (expectedVersion === undefined) return;
        const familyId = requireFamilyId(req.body);
        if (familyId === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "familyId is required.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.archiveList(principal, familyId, req.params.listId, expectedVersion, req.meta),
          toShoppingHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  const addItem = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const parsed = parseAddShoppingItemBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.addItem(principal, { ...parsed, listId: req.params.listId, traceId: req.meta.traceId }, req.meta),
      toShoppingHttpError,
    );
  });
  router.route("/shopping-lists/:listId/items").post(addItem).all(methodNotAllowed);
  router.route("/shopping/lists/:listId/items").post(addItem).all(methodNotAllowed);

  const updateItemState = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const expectedVersion = requireIfMatchVersion(req, res);
    if (expectedVersion === undefined) return;
    const parsed = parseUpdateShoppingItemBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.updateItemState(
        principal,
        parsed.familyId,
        req.params.listId,
        req.params.itemId,
        expectedVersion,
        parsed.state,
        req.meta,
      ),
      toShoppingHttpError,
    );
  });
  router.route("/shopping-lists/:listId/items/:itemId").patch(updateItemState).all(methodNotAllowed);
  router.route("/shopping/lists/:listId/items/:itemId").patch(updateItemState).all(methodNotAllowed);

  const batchAction = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const parsed = parseBatchActionBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.batchUpdateItemState(
        principal,
        parsed.familyId,
        req.params.listId,
        parsed.itemIds,
        parsed.state,
        req.meta,
      ),
      toShoppingHttpError,
    );
  });
  router.route("/shopping-lists/:listId/batch-action").post(batchAction).all(methodNotAllowed);
  router.route("/shopping/lists/:listId/batch-action").post(batchAction).all(methodNotAllowed);

  router
    .route("/shopping-lists/:listId")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const familyId = req.query.familyId;
        if (typeof familyId !== "string" || familyId.trim().length === 0) {
          sendFailure(res, 400, "VALIDATION_ERROR", "Query parameter familyId is required.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.getList(principal, familyId, req.params.listId, req.meta),
          toShoppingHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
