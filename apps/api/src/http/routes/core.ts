import { Router } from "express";
import type { OidcTokenVerifier } from "../../identity/oidc.js";
import { parseRegisterUserInput, registerUser, resolveKeycloakAdminConfig } from "../../identity/register.js";
import { sendFailure, sendSuccess } from "../envelope.js";
import { toRegistrationHttpError } from "../errors.js";
import { asyncHandler, methodNotAllowed, resolvePrincipal } from "../middleware.js";

export interface CoreRouteOptions {
  version: string;
  profile: string;
  startedAt: string;
  /** Returns whichever domain's OIDC verifier is configured, since they all share one issuer/audience. */
  getAnyVerifier: () => OidcTokenVerifier | undefined;
}

/** `/api/v1/meta`, `/api/v1/me` (+ `/auth/me` alias), and `/api/v1/auth/register` + `/auth/logout`. */
export function buildCoreRouter(options: CoreRouteOptions): Router {
  const router = Router();

  router
    .route("/meta")
    .get(
      asyncHandler(async (req, res) => {
        sendSuccess(
          res,
          200,
          {
            name: "gestione-dispensa-api",
            version: options.version,
            contract: "api/v1",
            profile: options.profile,
            startedAt: options.startedAt,
          },
          req.meta,
        );
      }),
    )
    .all(methodNotAllowed);

  const me = asyncHandler(async (req, res) => {
    const verifier = options.getAnyVerifier();
    if (verifier === undefined) {
      sendFailure(res, 503, "CAPABILITY_UNAVAILABLE", "Identity verification is not configured.", req.meta);
      return;
    }
    const principal = await resolvePrincipal(req, verifier);
    if (principal === undefined) {
      sendFailure(res, 401, "UNAUTHENTICATED", "Authentication is required.", req.meta);
      return;
    }
    const data: Record<string, unknown> = {
      id: principal.subject,
      subject: principal.subject,
      issuer: principal.issuer,
      roles: principal.roles,
      scopes: principal.scopes,
      expiresAt: principal.expiresAt.toISOString(),
    };
    if (principal.issuedAt !== undefined) data.issuedAt = principal.issuedAt.toISOString();
    sendSuccess(res, 200, data, req.meta);
  });
  router.route("/me").get(me).all(methodNotAllowed);
  router.route("/auth/me").get(me).all(methodNotAllowed);

  router
    .route("/auth/register")
    .post(
      asyncHandler(async (req, res) => {
        const parsed = parseRegisterUserInput(req.body);
        if (parsed === undefined) {
          sendFailure(
            res,
            400,
            "VALIDATION_ERROR",
            "Nome, email valida e password di almeno 8 caratteri sono obbligatori.",
            req.meta,
          );
          return;
        }
        try {
          const result = await registerUser(parsed, resolveKeycloakAdminConfig());
          sendSuccess(res, 201, result, req.meta);
        } catch (error) {
          const { status, body } = toRegistrationHttpError(error, req.meta);
          res.status(status).json(body);
        }
      }),
    )
    .all(methodNotAllowed);

  // Stateless JWT bearer auth: the server holds no session to invalidate (no opaque session id,
  // and the client never receives a refresh token this endpoint could revoke). Logging out is
  // the client's responsibility (discard the stored token); this endpoint just gives the client
  // a well-formed response to call on the way out, and always succeeds so a stale/expired token
  // never blocks the user from "logging out".
  router
    .route("/auth/logout")
    .post(
      asyncHandler(async (_req, res) => {
        res.status(204).end();
      }),
    )
    .all(methodNotAllowed);

  return router;
}
