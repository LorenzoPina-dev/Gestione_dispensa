import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { BarcodeCatalogAdapter, type BarcodeIdentifierType, type BarcodeProvider } from "./barcode.js";
import { OpenFoodFactsProvider } from "./providers/open-food-facts-provider.js";
import { CachingBarcodeProvider } from "./providers/caching-barcode-provider.js";
import {
  MongoOffCacheRepository,
  NullOffCacheRepository,
  type OffCacheRepository,
} from "./off-cache-repository.js";

/**
 * Entry point for the worker-integrations service. This runs as its OWN Docker container,
 * separate from the api service, on purpose: it talks to third-party APIs (Open Food Facts
 * today, possibly others later) whose latency and availability we do not control. Isolating it
 * means a slow/unreachable/crashing third party can never take the main api down with it — the
 * api calls this service over HTTP with its own timeout and circuit breaker (see
 * apps/api/src/catalog/external-barcode-client.ts) and simply degrades to "manual entry" if this
 * container is unhealthy.
 */

const PORT = Number(process.env.WORKER_INTEGRATIONS_PORT ?? 3100);
const PROVIDER_TIMEOUT_MS = Number(process.env.OPEN_FOOD_FACTS_TIMEOUT_MS ?? 4000);
const IDENTIFIER_TYPES: readonly BarcodeIdentifierType[] = ["EAN8", "EAN13", "GTIN12", "GTIN14", "BARCODE"];

function log(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
  // Plain structured JSON lines on stdout: no extra logging dependency, easy to pick up from
  // `docker logs` or ship to Loki like every other service in this stack.
  process.stdout.write(
    `${JSON.stringify({ level, event, service: "worker-integrations", ts: new Date().toISOString(), ...fields })}\n`,
  );
}

// --- Open Food Facts cache (optional) ---------------------------------------------------
// See docs/ADR-0005-off-cache-datastore.md. When OFF_CACHE_MONGO_URL is unset, offCache is a
// NullOffCacheRepository and the pipeline behaves exactly as it did before caching existed:
// every lookup goes straight to the live Open Food Facts API. Setting the URL turns on a
// read-through cache seeded from the Open Food Facts mongodump (see ops/off-cache-import) and
// filled incrementally from live API fallbacks. The cache is intentionally never a hard
// dependency: connection is lazy and every operation is wrapped in its own timeout + circuit
// breaker (see off-cache-repository.ts), so an absent, overloaded, or too-large-for-this-host
// cache database degrades straight back to "call the API", never to an outage.
const OFF_CACHE_MONGO_URL = process.env.OFF_CACHE_MONGO_URL;
const OFF_CACHE_DB = process.env.OFF_CACHE_DB ?? "openfoodfacts_cache";
const OFF_CACHE_COLLECTION = process.env.OFF_CACHE_COLLECTION ?? "products";
const OFF_CACHE_TIMEOUT_MS = Number(process.env.OFF_CACHE_TIMEOUT_MS ?? 300);
const OFF_CACHE_MAX_CONSECUTIVE_FAILURES = Number(process.env.OFF_CACHE_MAX_CONSECUTIVE_FAILURES ?? 3);
const OFF_CACHE_COOLDOWN_MS = Number(process.env.OFF_CACHE_COOLDOWN_MS ?? 30_000);

const offCache: OffCacheRepository =
  OFF_CACHE_MONGO_URL !== undefined && OFF_CACHE_MONGO_URL.trim().length > 0
    ? new MongoOffCacheRepository({
        mongoUrl: OFF_CACHE_MONGO_URL,
        dbName: OFF_CACHE_DB,
        collectionName: OFF_CACHE_COLLECTION,
        operationTimeoutMs:
          Number.isFinite(OFF_CACHE_TIMEOUT_MS) && OFF_CACHE_TIMEOUT_MS > 0 ? OFF_CACHE_TIMEOUT_MS : 300,
        maxConsecutiveFailures:
          Number.isFinite(OFF_CACHE_MAX_CONSECUTIVE_FAILURES) && OFF_CACHE_MAX_CONSECUTIVE_FAILURES > 0
            ? OFF_CACHE_MAX_CONSECUTIVE_FAILURES
            : 3,
        cooldownMs:
          Number.isFinite(OFF_CACHE_COOLDOWN_MS) && OFF_CACHE_COOLDOWN_MS > 0 ? OFF_CACHE_COOLDOWN_MS : 30_000,
        log,
      })
    : new NullOffCacheRepository();

const offCacheEnabled = OFF_CACHE_MONGO_URL !== undefined && OFF_CACHE_MONGO_URL.trim().length > 0;
log("info", "off_cache_configured", { enabled: offCacheEnabled, db: OFF_CACHE_DB, collection: OFF_CACHE_COLLECTION });

const offFactsProvider = new OpenFoodFactsProvider({ baseUrl: process.env.OPEN_FOOD_FACTS_BASE_URL });
const barcodeProvider: BarcodeProvider = offCacheEnabled
  ? new CachingBarcodeProvider({ inner: offFactsProvider, cache: offCache, log })
  : offFactsProvider;

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
  void (async () => {
    // Cache availability is reported for observability only. It never affects the readiness
    // status code: the cache is optional, so an unavailable cache must not mark this service
    // (or take down the api's dependency check) as unready.
    const cacheAvailable = offCacheEnabled ? await offCache.isAvailable() : false;
    res.status(200).json({ status: "ok", offCache: { enabled: offCacheEnabled, available: cacheAvailable } });
  })();
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
  server.close(() => {
    void offCache.close().finally(() => process.exit(0));
  });
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
