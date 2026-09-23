import { Router } from "express";
import { FamilyController, toFamilyHttpError } from "../../family/controller.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { asyncHandler, methodNotAllowed, resolvePrincipal } from "../middleware.js";
import {
  parseAcceptInviteBody,
  parseCreateFamilyBody,
  parseCreateInviteBody,
  parseResolveInviteBody,
  parseResolveInviteByCodeBody,
  parseUpdateMembershipBody,
} from "../validators.js";

export interface FamilyRouteDependencies {
  controller: FamilyController;
  verifier: OidcTokenVerifier;
}

/**
 * The family domain HTTP surface: families, memberships, and invites (create, resolve by token
 * or code, review, accept/reject, revoke). Registered at `/api/v1` so paths below read exactly
 * like the URLs they serve.
 *
 * Every path is built with `router.route(path)` so a method not explicitly chained on it falls
 * through to the trailing `.all(methodNotAllowed)` and reports 405 instead of a bare 404.
 */
export function buildFamilyRouter(deps: FamilyRouteDependencies): Router {
  const { controller, verifier } = deps;
  const router = Router();

  router
    .route("/families")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(res, req.meta, controller.listFamilies(principal, req.meta), toFamilyHttpError);
      }),
    )
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const parsed = parseCreateFamilyBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.createFamily(principal, { ...parsed, traceId: req.meta.traceId }, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/families/:familyId")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.getFamily(principal, req.params.familyId, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/families/:familyId/members")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.listMembers(principal, req.params.familyId, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/families/:familyId/members/:membershipId")
    .patch(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const parsed = parseUpdateMembershipBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.updateMembership(principal, req.params.familyId, req.params.membershipId, parsed, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .delete(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.removeMembership(principal, req.params.familyId, req.params.membershipId, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/families/:familyId/invites")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.listInvites(principal, req.params.familyId, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const parsed = parseCreateInviteBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.createInvite(principal, req.params.familyId, parsed, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/families/:familyId/invites/:inviteId/revoke")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.revokeInvite(principal, req.params.familyId, req.params.inviteId, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  // Both `/invites/resolve` and the legacy `/family-invites/resolve` alias are wired.
  const resolveInviteHandler = asyncHandler(async (req, res) => {
    const parsed = parseResolveInviteBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.resolveInvite(parsed.token, parsed.browserBindingHash, req.meta.traceId, req.meta),
      toFamilyHttpError,
    );
  });
  router.route("/invites/resolve").post(resolveInviteHandler).all(methodNotAllowed);
  router.route("/family-invites/resolve").post(resolveInviteHandler).all(methodNotAllowed);

  const resolveInviteByCodeHandler = asyncHandler(async (req, res) => {
    const parsed = parseResolveInviteByCodeBody(req.body);
    if (parsed === undefined) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
      return;
    }
    await respond(
      res,
      req.meta,
      controller.resolveInviteByCode(parsed.code, parsed.browserBindingHash, req.meta.traceId, req.meta),
      toFamilyHttpError,
    );
  });
  router.route("/invites/resolve-code").post(resolveInviteByCodeHandler).all(methodNotAllowed);
  router.route("/family-invites/resolve-code").post(resolveInviteByCodeHandler).all(methodNotAllowed);

  router
    .route("/family-invites/:attemptId/review")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.reviewInvite(principal, req.params.attemptId, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/family-invites/:attemptId/reject")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          controller.rejectInvite(principal, req.params.attemptId, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/invites/:attemptId/accept")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const parsed = parseAcceptInviteBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          controller.acceptInvite(principal, req.params.attemptId, parsed.consentVersion, req.meta),
          toFamilyHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
