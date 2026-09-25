import express, { type Request, type Response } from "express";

/**
 * Entry point for the worker-integrations service.
 *
 * Barcode resolution used to live here (BarcodeCatalogAdapter + OffLookupProvider, calling the
 * off-lookup microservice) but was removed: apps/api talks to off-lookup DIRECTLY (see
 * apps/api/src/catalog/external-barcode-client.ts, HttpOffLookupClient, wired via
 * OFF_LOOKUP_BASE_URL in server.ts) and always did once off-lookup existed, so this service's
 * `/internal/v1/barcode/lookup` route had no caller left in the deployed stack -- it wasn't even
 * present in infra/compose/family-local.yml anymore. The removed source (barcode.ts,
 * barcode-runtime.ts, providers/off-lookup-provider.ts) and its tests were moved to
 * services/worker-integrations/_deprecated/ for reference; see that folder's README for the
 * exact `git rm` command to drop them for good.
 *
 * What's left -- offers.ts/offers-runtime.ts, recipes-nutrition.ts/recipes-runtime.ts,
 * recognition.ts/recognition-runtime.ts -- is kept as-is on purpose: none of it is wired into
 * this file yet (no routes below reference them), and it is expected to be replaced by
 * dedicated microservices later, the same way barcode resolution was replaced by off-lookup.
 * Until then this process only serves health checks.
 */

const PORT = Number(process.env.WORKER_INTEGRATIONS_PORT ?? 3100);

function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level, event, service: "worker-integrations", ts: new Date().toISOString(), ...fields })}\n`,
  );
}

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health/ready", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  log("info", "worker_integrations_started", { port: PORT });
});

// Last-resort safety nets. This service is intentionally disposable: on a truly unexpected
// error we log and exit, and Docker's `restart: unless-stopped` policy brings it back up. We
// never try to "limp along" after an uncaught exception, since that risks serving corrupted state.
process.on("uncaughtException", (error) => {
  log("error", "uncaught_exception", { error: error.message, stack: error.stack });
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
});
process.on("unhandledRejection", (reason) => {
  log("error", "unhandled_rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});

function shutdown(signal: string): void {
  log("info", "worker_integrations_shutdown", { signal });
  server.close(() => process.exit(0));
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
