import { Router } from "express";
import { PrivacyErasureService } from "../../privacy/erasure.js";
import { PrivacyExportService } from "../../privacy/export.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { toPrivacyErasureHttpError, toPrivacyExportHttpError } from "../errors.js";
import { asyncHandler, methodNotAllowed, requireIdempotencyKey, resolvePrincipal } from "../middleware.js";
import { parseConsentBody, parseErasureRequestBody, parseExportRequestBody } from "../validators.js";

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
    .route("/privacy/erasure")
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
      erasure.listConsents(principal).then((data) => ({ data, meta: req.meta })),
      toPrivacyErasureHttpError,
    );
  });
  const updateConsent = asyncHandler(async (req, res) => {
    const principal = await resolvePrincipal(req, verifier);
    const parsed = parseConsentBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      erasure
        .updateConsent(principal, parsed.purpose, parsed.granted, parsed.consentVersion, req.meta.traceId)
        .then((data) => ({ data, meta: req.meta })),
      toPrivacyErasureHttpError,
    );
  });
  router.route("/privacy/consents").get(listConsents).put(updateConsent).all(methodNotAllowed);
  router.route("/privacy/consent").get(listConsents).put(updateConsent).all(methodNotAllowed);

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

  router
    .route("/privacy/export/:exportId")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          exportService
            .download(principal, req.params.exportId, req.meta.traceId)
            .then((data) => ({ data, meta: req.meta })),
          toPrivacyExportHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
