import { Router } from "express";
import { RecipeController, toRecipeHttpError } from "../../recipes/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { asyncHandler, methodNotAllowed, resolvePrincipal } from "../middleware.js";

export interface RecipeRouteDependencies {
  controller: RecipeController;
  verifier: OidcTokenVerifier;
}

export function buildRecipesRouter(deps: RecipeRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  // Sostituisci il blocco `router.route("/recipes/suggestions")...` con questo
// blocco, che aggiunge `listRecipes` e `getRecipe` prima di `:recipeId`:

  // 1) GET /recipes
  router
    .route("/recipes")
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
          controller.listRecipes(principal, familyId, req.meta),
          toRecipeHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  // 2) GET /recipes/suggestions  (deve restare PRIMA di /recipes/:recipeId)
  router
    .route("/recipes/suggestions")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const familyId = req.query.familyId;
        if (typeof familyId !== "string" || familyId.trim().length === 0) {
          sendFailure(res, 400, "VALIDATION_ERROR", "Query parameter familyId is required.", req.meta);
          return;
        }
        await respond(res, req.meta, controller.listSuggestions(principal, familyId, req.meta), toRecipeHttpError);
      }),
    )
    .all(methodNotAllowed);

  // 3) GET /recipes/:recipeId
  router
    .route("/recipes/:recipeId")
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
          controller.getRecipe(principal, familyId, req.params.recipeId as string, req.meta),
          toRecipeHttpError,
        );
      }),
    )
    .all(methodNotAllowed);
    
  router
    .route("/recipes/:recipeId/add-missing")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const familyId = typeof req.body.familyId === "string" ? req.body.familyId : "";
        if (familyId.length === 0) {
          sendFailure(res, 400, "VALIDATION_ERROR", "familyId is required.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.addMissingIngredients(principal, familyId, req.params.recipeId as string, req.meta.traceId, req.meta),
          toRecipeHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/recipes/:recipeId/cook")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const familyId = typeof req.body.familyId === "string" ? req.body.familyId : "";
        const servings = typeof req.body.servings === "number" ? req.body.servings : NaN;
        if (familyId.length === 0 || !Number.isFinite(servings) || servings <= 0) {
          sendFailure(res, 400, "VALIDATION_ERROR", "familyId and a positive servings are required.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.cook(principal, familyId, req.params.recipeId as string, servings, req.meta.traceId, req.meta),
          toRecipeHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
