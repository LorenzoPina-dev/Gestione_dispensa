import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { OidcTokenVerifier, Principal } from "../identity/oidc.js";
import { applyCorrelationHeaders, buildMeta, sendFailure, type HttpMeta } from "./envelope.js";

declare module "express-serve-static-core" {
  interface Request {
    meta: HttpMeta;
  }
}

/**
 * Mirrors the CORS handling the raw http server used to do by hand: echoes back the request
 * origin (with credentials) when one is present, otherwise allows any origin, and short-circuits
 * preflight OPTIONS requests with a bare 204.
 */
export function corsMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, If-Match, Idempotency-Key, x-request-id, x-trace-id",
    );
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Attaches `req.meta` and the correlation-id response headers to every request. */
export function requestMetaMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const meta = buildMeta(req);
    req.meta = meta;
    applyCorrelationHeaders(res, meta);
    next();
  };
}

/**
 * Resolves the caller's Principal from the Authorization header. Invalid or missing credentials
 * resolve to `undefined` rather than throwing, so public routes (invite resolve, barcode lookup)
 * keep working and controllers apply their own 401 handling uniformly.
 */
export async function resolvePrincipal(
  req: Request,
  verifier: OidcTokenVerifier,
): Promise<Principal | undefined> {
  try {
    return await verifier.verifyAuthorizationHeader(req.headers.authorization);
  } catch {
    return undefined;
  }
}

/** Requires an `If-Match` header holding a positive integer version; writes 428 and returns undefined otherwise. */
export function requireIfMatchVersion(req: Request, res: Response): number | undefined {
  const ifMatch = req.header("if-match");
  const expectedVersion = typeof ifMatch === "string" ? Number(ifMatch.trim()) : NaN;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    sendFailure(
      res,
      428,
      "PRECONDITION_REQUIRED",
      "An If-Match header with the current version is required.",
      req.meta,
    );
    return undefined;
  }
  return expectedVersion;
}

/** Requires a non-blank `If-Match` header string (used by the inventory-movement route, which passes it through as-is). */
export function requireIfMatchHeader(req: Request, res: Response): string | undefined {
  const ifMatch = req.header("if-match");
  if (typeof ifMatch !== "string" || ifMatch.trim().length === 0) {
    sendFailure(
      res,
      428,
      "PRECONDITION_REQUIRED",
      "An If-Match header with the current version is required.",
      req.meta,
    );
    return undefined;
  }
  return ifMatch;
}

/** Requires a non-blank `Idempotency-Key` header; writes 400 and returns undefined otherwise. */
export function requireIdempotencyKey(req: Request, res: Response): string | undefined {
  const key = req.header("idempotency-key");
  if (typeof key !== "string" || key.trim().length === 0) {
    sendFailure(res, 400, "VALIDATION_ERROR", "An Idempotency-Key header is required.", req.meta);
    return undefined;
  }
  return key;
}

/**
 * Attached last on a `router.route(path)` chain (after every method-specific handler) so any
 * method not explicitly wired for that path reports 405 instead of falling through to 404.
 * Express Route layers run in registration order and only reach a later layer if no earlier
 * layer on the same route already matched the method and responded, so this only ever fires for
 * the "wrong method, right path" case.
 */
export function methodNotAllowed(req: Request, res: Response): void {
  sendFailure(res, 405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", req.meta);
}

/** Wraps an async Express handler so a rejected promise reaches Express's error middleware instead of crashing the process. */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
