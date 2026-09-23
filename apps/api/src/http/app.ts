import express, { type NextFunction, type Request, type Response } from "express";
import type { PostgresLiveness } from "./routes/health.js";
import type { OidcTokenVerifier } from "../identity/oidc.js";
import { buildCoreRouter } from "./routes/core.js";
import { buildCatalogRouter, type CatalogRouteDependencies } from "./routes/catalog.js";
import { buildFamilyRouter, type FamilyRouteDependencies } from "./routes/family.js";
import { buildHealthRouter } from "./routes/health.js";
import { buildInventoryRouter, type InventoryRouteDependencies } from "./routes/inventory.js";
import { buildJobsRouter, type JobAdminRouteDependencies } from "./routes/jobs.js";
import { buildNotificationsRouter, type NotificationRouteDependencies } from "./routes/notifications.js";
import { buildNutritionRouter, type NutritionRouteDependencies } from "./routes/nutrition.js";
import { buildPrivacyRouter, type PrivacyRouteDependencies } from "./routes/privacy.js";
import { buildRecipesRouter, type RecipeRouteDependencies } from "./routes/recipes.js";
import { buildShoppingRouter, type ShoppingRouteDependencies } from "./routes/shopping.js";
import { buildMeta, sendFailure, type HttpMeta } from "./envelope.js";
import { corsMiddleware, requestMetaMiddleware } from "./middleware.js";

export type {
  CatalogRouteDependencies,
  FamilyRouteDependencies,
  InventoryRouteDependencies,
  JobAdminRouteDependencies,
  NotificationRouteDependencies,
  NutritionRouteDependencies,
  PostgresLiveness,
  PrivacyRouteDependencies,
  RecipeRouteDependencies,
  ShoppingRouteDependencies,
};

const MAX_BODY_BYTES = 1_000_000;

export interface ApiServerOptions {
  version: string;
  profile: string;
  startedAt?: string;
  /** When provided, /health/ready reports a real liveness probe instead of the static placeholder. */
  postgres?: PostgresLiveness;
  /** When provided, wires the family domain HTTP surface. Omitted => those routes 404. */
  family?: FamilyRouteDependencies;
  /** When provided, wires the inventory domain HTTP surface. Omitted => those routes 404. */
  inventory?: InventoryRouteDependencies;
  /** When provided, wires the catalog domain HTTP surface. */
  catalog?: CatalogRouteDependencies;
  /** When provided, wires the shopping domain HTTP surface. */
  shopping?: ShoppingRouteDependencies;
  /** When provided, wires `GET /api/v1/notifications` and `POST .../read`. */
  notifications?: NotificationRouteDependencies;
  /** When provided, wires `GET /api/v1/nutrition/summary`. */
  nutrition?: NutritionRouteDependencies;
  /** When provided, wires the recipe suggestion/add-missing/cook HTTP surface. */
  recipes?: RecipeRouteDependencies;
  /** When provided, wires operator-only job administration routes. */
  jobs?: JobAdminRouteDependencies;
  /** When provided, wires the privacy HTTP surface: erasure, consent, export/download. */
  privacy?: PrivacyRouteDependencies;
}

/**
 * Builds the Express application: an `express.json()` body parser, CORS + correlation-id
 * middleware, the health/meta/auth core routes, then every optional domain router that has
 * dependencies configured in `options`, and finally a 404 fallback plus a last-resort error
 * handler mirroring the previous raw-`node:http` router's envelope shapes exactly, so every
 * existing client and test keeps seeing the same wire contract.
 */
export function buildApp(options: ApiServerOptions) {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use(corsMiddleware());
  app.use(requestMetaMiddleware());
  app.use((_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    next();
  });
  app.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));

  app.use(
    buildCoreRouter({
      version: options.version,
      profile: options.profile,
      startedAt,
      getAnyVerifier: () => firstVerifier(options),
    }),
  );
  app.use(buildHealthRouter(options.version, options.postgres));

  const apiRouter = express.Router();
  if (options.family) apiRouter.use(buildFamilyRouter(options.family));
  if (options.inventory) apiRouter.use(buildInventoryRouter(options.inventory));
  if (options.catalog) apiRouter.use(buildCatalogRouter(options.catalog));
  if (options.shopping) apiRouter.use(buildShoppingRouter(options.shopping));
  if (options.notifications) apiRouter.use(buildNotificationsRouter(options.notifications));
  if (options.nutrition) apiRouter.use(buildNutritionRouter(options.nutrition));
  if (options.recipes) apiRouter.use(buildRecipesRouter(options.recipes));
  if (options.jobs) apiRouter.use(buildJobsRouter(options.jobs));
  if (options.privacy) apiRouter.use(buildPrivacyRouter(options.privacy));
  app.use("/api/v1", apiRouter);

  // Nothing matched: stable 404 envelope, same as every other unmapped path/method combination.
  app.use((req: Request, res: Response) => {
    sendFailure(res, 404, "NOT_FOUND_OR_NOT_VISIBLE", "The resource is not available.", req.meta ?? buildMeta(req));
  });

  // Last-resort handler: body-parser errors (bad JSON, payload too large) and anything an
  // asyncHandler forwarded via next(error). Mirrors the previous router's top-level catch.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4 args to recognize error middleware
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const meta: HttpMeta = req.meta ?? buildMeta(req);
    if (res.headersSent) return;
    const bodyError = err as { type?: string; status?: number } | undefined;
    if (bodyError?.type === "entity.too.large") {
      sendFailure(res, 413, "PAYLOAD_TOO_LARGE", "The request body is too large.", meta);
      return;
    }
    if (bodyError?.type === "entity.parse.failed" || bodyError instanceof SyntaxError) {
      sendFailure(res, 400, "VALIDATION_ERROR", "The request body is not valid JSON.", meta);
      return;
    }
    sendFailure(res, 500, "INTERNAL_ERROR", "The request could not be completed.", meta);
    // eslint-disable-next-line no-console -- last-resort diagnostic for an otherwise-swallowed failure
    console.error("unhandled_request_error", err);
  });

  return app;
}

function firstVerifier(options: ApiServerOptions): OidcTokenVerifier | undefined {
  return (
    options.family?.verifier ??
    options.inventory?.verifier ??
    options.catalog?.verifier ??
    options.shopping?.verifier ??
    options.notifications?.verifier ??
    options.nutrition?.verifier ??
    options.recipes?.verifier ??
    options.jobs?.verifier ??
    options.privacy?.verifier
  );
}
