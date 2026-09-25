import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { BarcodeCatalogAdapter, type BarcodeIdentifierType, type BarcodeProvider } from "./barcode.js";
import { OffLookupProvider } from "./providers/off-lookup-provider.js";

/**
 * Entry point for the worker-integrations service. This runs as its OWN Docker container,
 * separate from the api service, on purpose: it talks to third-party services whose latency
 * and availability we do not control. Isolating it means a slow/unreachable/crashing dependency
 * can never take the main api down with it — the api calls this service over HTTP with its own
 * timeout and circuit breaker (see apps/api/src/catalog/external-barcode-client.ts) and simply
 * degrades to "manual entry" if this container is unhealthy.
 *
 * Barcode resolution is fully delegated to the off-lookup microservice (services/off-lookup),
 * which implements the Read-Through cache pattern against the local Open Food Facts MongoDB dump
 * and the live OFF API v3. This service no longer talks to MongoDB or to Open Food Facts directly.
 */

const PORT = Number(process.env.WORKER_INTEGRATIONS_PORT ?? 3100);
const PROVIDER_TIMEOUT_MS = Number(process.env.OPEN_FOOD_FACTS_TIMEOUT_MS ?? 4000);
const IDENTIFIER_TYPES: readonly BarcodeIdentifierType[] = ["EAN8", "EAN13", "GTIN12", "GTIN14", "BARCODE"];

function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level, event, service: "worker-integrations", ts: new Date().toISOString(), ...fields })}\n`,
  );
}

// --- off-lookup HTTP provider ---------------------------------------------------------------
// All barcode resolution (local MongoDB dump + live OFF API fallback) is handled by the
// off-lookup microservice. OFF_LOOKUP_BASE_URL must point to it (e.g. http://off-lookup:3200).
// When unset, OffLookupProvider returns PROVIDER_UNAVAILABLE immediately (circuit open path),
// which BarcodeCatalogAdapter maps to DEGRADED — manual entry, never a crash.
const OFF_LOOKUP_BASE_URL = process.env.OFF_LOOKUP_BASE_URL ?? "";
const offLookupEnabled = OFF_LOOKUP_BASE_URL.trim().length > 0;
log("info", "off_lookup_provider_configured", {
  enabled: offLookupEnabled,
  baseUrl: offLookupEnabled ? OFF_LOOKUP_BASE_URL : "(not set)",
});

const barcodeProvider: BarcodeProvider = new OffLookupProvider({
  baseUrl: OFF_LOOKUP_BASE_URL,
  timeoutMs: Number.isFinite(PROVIDER_TIMEOUT_MS) && PROVIDER_TIMEOUT_MS > 0 ? PROVIDER_TIMEOUT_MS : 4000,
  log,
});

const adapter = new BarcodeCatalogAdapter({
  provider: barcodeProvider,
  timeoutMs: Number.isFinite(PROVIDER_TIMEOUT_MS) && PROVIDER_TIMEOUT_MS > 0 ? PROVIDER_TIMEOUT_MS : 4000,
});

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health/ready", (_req: Request, res: Response) => {
  // off-lookup is an optional dependency: when absent the service degrades to DEGRADED
  // barcode results (manual entry), never to an outage. The readiness endpoint always
  // returns 200 so the api's own health check never gates on this worker's upstream.
  res.status(200).json({
    status: "ok",
    offLookup: { enabled: offLookupEnabled, baseUrl: offLookupEnabled ? OFF_LOOKUP_BASE_URL : null },
  });
});

app.post(
  "/internal/v1/barcode/lookup",
  (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const traceId =
        typeof req.body?.traceId === "string" && req.body.traceId.trim().length >= 16
          ? (req.body.traceId as string)
          : randomUUID().replaceAll("-", "");
      const identifierType = req.body?.identifierType;
      const value = req.body?.value;

      if (
        typeof identifierType !== "string" ||
        !IDENTIFIER_TYPES.includes(identifierType as BarcodeIdentifierType) ||
        typeof value !== "string" ||
        value.trim().length === 0
      ) {
        res.status(400).json({ error: "identifierType and value are required." });
        return;
      }

      try {
        const result = await adapter.lookup(identifierType as BarcodeIdentifierType, value, traceId);
        res.status(200).json(result);
      } catch (error) {
        // Belt-and-braces: BarcodeCatalogAdapter already converts provider errors into a typed
        // DEGRADED result, so this branch should be unreachable — but if something still throws,
        // respond with a safe degraded payload instead of a 500 or letting it become an
        // unhandled rejection.
        log("error", "barcode_lookup_unexpected_error", {
          traceId,
          error: error instanceof Error ? error.message : "unknown",
        });
        res.status(200).json({ state: "DEGRADED", reason: "PROVIDER_UNAVAILABLE" });
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

const server = app.listen(PORT, "0.0.0.0", () => {
  log("info", "worker_integrations_started", { port: PORT, providerTimeoutMs: PROVIDER_TIMEOUT_MS });
});

// Last-resort safety nets. This service is intentionally disposable: on a truly unexpected
// error we log and exit, and Docker's `restart: unless-stopped` policy (see
// infra/compose/family-local.yml) brings it back up. We never try to "limp along" after an
// uncaught exception, since that risks serving corrupted state.
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
