import { Router } from "express";
import { PrivacyErasureService } from "../../privacy/erasure.js";
import { PrivacyExportService } from "../../privacy/export.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { toPrivacyErasureHttpError, toPrivacyExportHttpError } from "../errors.js";
import { asyncHandler, methodNotAllowed, requireIdempotencyKey, resolvePrincipal } from "../middleware.js";
import { parseConsentsBody, parseErasureRequestBody, parseExportRequestBody } from "../validators.js";

export interface PrivacyRouteDependencies {
  erasure: PrivacyErasureService;
  export: PrivacyExportService;
  verifier: OidcTokenVerifier;
}

/** Privacy HTTP surface: erasure requests, consent management, and data export/download. */
export function buildPrivacyRouter(deps: PrivacyRouteDependencies): Router {
  const { erasure, export: exportService, verifier } = deps;
  const router = Router();

  router
    .route("/privacy/erase")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const idempotencyKey = requireIdempotencyKey(req, res);
        if (idempotencyKey === undefined) return;
        const parsed = parseErasureRequestBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          erasure
            .request(principal, parsed.familyId, parsed.confirmed, idempotencyKey, req.meta.traceId)
            .then((data) => ({ data, meta: req.meta })),
          toPrivacyErasureHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  const listConsents = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    await respond(
      res,
      req.meta,
      erasure.listConsents(principal).then((rows) => ({
        data: {
          analytics: rows.find((x) => x.purpose === "analytics")?.granted ?? false,
          personalization: rows.find((x) => x.purpose === "personalization")?.granted ?? false,
          notifications: rows.find((x) => x.purpose === "notifications")?.granted ?? false,
        },
        meta: req.meta,
        version: 1,
      })),
      toPrivacyErasureHttpError,
    );
  });
  const updateConsents = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const idempotencyKey = requireIdempotencyKey(req, res);
    if (idempotencyKey === undefined) return;
    const parsed = parseConsentsBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      erasure
        .updateConsents(principal, parsed, req.meta.traceId)
        .then((rows) => ({
          data: {
            analytics: rows.find((x) => x.purpose === "analytics")?.granted ?? false,
            personalization: rows.find((x) => x.purpose === "personalization")?.granted ?? false,
            notifications: rows.find((x) => x.purpose === "notifications")?.granted ?? false,
          },
          meta: req.meta,
          version: 1,
        })),
      toPrivacyErasureHttpError,
    );
  });
  router.route("/privacy/consents").get(listConsents).put(updateConsents).all(methodNotAllowed);

  router
    .route("/privacy/export")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const idempotencyKey = requireIdempotencyKey(req, res);
        if (idempotencyKey === undefined) return;
        const parsed = parseExportRequestBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          exportService
            .create(principal, parsed.familyId, idempotencyKey, req.meta.traceId)
            .then((data) => ({ data, meta: req.meta })),
          toPrivacyExportHttpError,
        );
      }),
    )
    .all(methodNotAllowed);



  return router;
}
