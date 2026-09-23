import { Router } from "express";
import { sendSuccess } from "../envelope.js";
import { asyncHandler, methodNotAllowed } from "../middleware.js";

export interface PostgresLiveness {
  ping(): Promise<boolean>;
}

/** `/health/live` and `/health/ready`, mounted at the server root (not under `/api/v1`). */
export function buildHealthRouter(version: string, postgres?: PostgresLiveness): Router {
  const router = Router();

  router
    .route("/health/live")
    .get(
      asyncHandler(async (req, res) => {
        sendSuccess(res, 200, { status: "ok", service: "api", version }, req.meta);
      }),
    )
    .all(methodNotAllowed);

  router
    .route("/health/ready")
    .get(
      asyncHandler(async (req, res) => {
        const postgresStatus = postgres ? ((await postgres.ping()) ? "ok" : "unreachable") : "not-configured";
        sendSuccess(
          res,
          200,
          { status: "ready", service: "api", version, dependencies: { postgres: postgresStatus, redis: "not-configured" } },
          req.meta,
        );
      }),
    )
    .all(methodNotAllowed);

  return router;
}
