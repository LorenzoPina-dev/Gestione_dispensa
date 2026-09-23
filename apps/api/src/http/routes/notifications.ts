import { Router } from "express";
import { NotificationController, toNotificationHttpError } from "../../notifications/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { asyncHandler, methodNotAllowed, resolvePrincipal } from "../middleware.js";

export interface NotificationRouteDependencies {
  controller: NotificationController;
  verifier: OidcTokenVerifier;
}

export function buildNotificationsRouter(deps: NotificationRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  router
    .route("/notifications")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const familyId = req.query.familyId;
        if (typeof familyId !== "string" || familyId.trim().length === 0) {
          sendFailure(res, 400, "VALIDATION_ERROR", "Query parameter familyId is required.", req.meta);
          return;
        }
        await respond(res, req.meta, controller.list(principal, familyId, req.meta), toNotificationHttpError);
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/notifications/:notificationId/read")
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
          controller.markRead(principal, familyId, req.params.notificationId, req.meta),
          toNotificationHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
