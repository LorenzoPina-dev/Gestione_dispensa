import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { log } from "./logger.js";
import { createProductRepository } from "./mongo-product-repository.js";
import { OpenFoodFactsApiClient } from "./off-api-client.js";
import { ProductLookupService, isValidBarcode } from "./product-lookup-service.js";

/**
 * OFF-Lookup: standalone microservice dedicated to barcode -> product resolution.
 *
 * Runs as its OWN container, separate from worker-integrations and from the api service, on
 * purpose:
 *  - it is the only service that talks to the local Open Food Facts MongoDB dump (potentially
 *    tens of GB) and to the public Open Food Facts API;
 *  - worker-integrations calls it over HTTP with its own timeout + circuit breaker (see
 *    services/worker-integrations/src/providers/off-lookup-provider.ts) and simply degrades to
 *    "manual entry" if this container is absent, unhealthy, or still restoring the dump;
 *  - the local database is entirely optional (see mongo-product-repository.ts): with
 *    OFF_LOOKUP_MONGO_URL unset, or unreachable, every lookup transparently falls through to the
 *    live API, exactly as if no cache existed at all.
 */

const repository = createProductRepository();
const apiClient = new OpenFoodFactsApiClient();
const lookupService = new ProductLookupService(repository, apiClient);

const app = express();
app.disable("x-powered-by");

app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health/ready", (_req: Request, res: Response) => {
  void (async () => {
    // Dependency availability is reported for observability only. Neither the local database nor
    // the remote API being down ever flips this to a non-200: OFF-Lookup keeps accepting
    // requests and degrades per-request instead (see ProductLookupService).
    const mongoAvailable = await repository.isAvailable();
    res.status(200).json({
      status: "ok",
      mongo: { available: mongoAvailable },
      offApi: { circuitOpen: apiClient.isCircuitOpen() },
    });
  })();
});

app.get(
  "/api/v1/products/:barcode",
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const barcode = req.params.barcode?.trim() ?? "";
      if (!isValidBarcode(barcode)) {
        res.status(400).json({ error: "invalid_barcode", message: "Expected 6 to 14 numeric digits." });
        return;
      }

      const result = await lookupService.lookup(barcode);
      switch (result.outcome) {
        case "hit": {
          res.status(200).json({ code: barcode, source: result.source, product: result.product });
          return;
        }
        case "not_found": {
          res.status(404).json({ error: "product_not_found", code: barcode });
          return;
        }
        case "unavailable": {
          // Neither the local dump nor the live API could confirm or deny this barcode right
          // now. 503 (with Retry-After) is more honest than a false 404 and lets callers with
          // their own circuit breaker (worker-integrations) treat it as "try again later"
          // rather than "definitely does not exist".
          res.status(503).set("Retry-After", "5").json({ error: "lookup_unavailable", code: barcode, reason: result.reason });
          return;
        }
      }
    })().catch(next);
  },
);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

// Express error-handling middleware (4 args) must be registered last; it catches anything
// forwarded via next(err) so a bug never surfaces as a crashed process.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  log("error", "unhandled_request_error", { error: error instanceof Error ? error.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

const server = app.listen(config.port, "0.0.0.0", () => {
  log("info", "off_lookup_started", { port: config.port });
});

// Last-resort safety nets, consistent with every other service in this stack: on a truly
// unexpected error we log and exit, and Docker's `restart: unless-stopped` policy brings the
// container back up. We never try to "limp along" after an uncaught exception.
process.on("uncaughtException", (error) => {
  log("error", "uncaught_exception", { error: error.message, stack: error.stack });
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
});
process.on("unhandledRejection", (reason) => {
  log("error", "unhandled_rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});

function shutdown(signal: string): void {
  log("info", "off_lookup_shutdown", { signal });
  server.close(() => {
    void repository.close().finally(() => process.exit(0));
  });
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
