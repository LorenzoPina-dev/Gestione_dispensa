import { Router } from "express";
import { JobAdministrationService } from "../../jobs/admin.js";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { respond, sendFailure } from "../envelope.js";
import { toJobAdminHttpError } from "../errors.js";
import { asyncHandler, methodNotAllowed, resolvePrincipal } from "../middleware.js";
import { parseReplayBody } from "../validators.js";

export interface JobAdminRouteDependencies {
  service: JobAdministrationService;
  verifier: OidcTokenVerifier;
}

/** Operator-only job administration routes: inspect a job, replay a dead letter. */
export function buildJobsRouter(deps: JobAdminRouteDependencies): Router {
  const { service, verifier } = deps;
  const router = Router();

  router
    .route("/admin/jobs/:jobId")
    .get(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        await respond(
          res,
          req.meta,
          service.inspect(principal, req.params.jobId as string, req.meta.traceId).then((data) => ({ data, meta: req.meta })),
          toJobAdminHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/admin/dead-letters/:deadLetterId/replay")
    .post(
      asyncHandler(async (req, res) => {
        const principal = await resolvePrincipal(req, verifier);
        const parsed = parseReplayBody(req.body);
        if (parsed === undefined) {
          sendFailure(res, 400, "VALIDATION_ERROR", "The request body is invalid.", req.meta);
          return;
        }
        await respond(
          res,
          req.meta,
          service
            .replay(principal, req.params.deadLetterId as string, { ...parsed, traceId: req.meta.traceId })
            .then((data) => ({ data, meta: req.meta })),
          toJobAdminHttpError,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
