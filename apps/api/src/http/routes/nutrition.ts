import { Router } from "express";
import { NutritionController, toNutritionHttpError } from "../../nutrition/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { asyncHandler, methodNotAllowed, resolvePrincipal } from "../middleware.js";

export interface NutritionRouteDependencies {
  controller: NutritionController;
  verifier: OidcTokenVerifier;
}

export function buildNutritionRouter(deps: NutritionRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  router
    .route("/nutrition/summary")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const familyId = req.query.familyId;
        const periodParam = req.query.period;
        const period = periodParam === "week" ? "week" : "today";
        if (typeof familyId !== "string" || familyId.trim().length === 0) {
          sendFailure(res, 400, "VALIDATION_ERROR", "Query parameter familyId is required.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.getSummary(principal, familyId, period, req.meta),
          toNutritionHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
