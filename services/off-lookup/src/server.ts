import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { log } from "./logger.js";
import { createProductRepository } from "./mongo-product-repository.js";
import { OpenFoodFactsApiClient } from "./off-api-client.js";
import { ProductLookupService, isValidBarcode } from "./product-lookup-service.js";
import { HttpSearchIndexerClient } from "./search-indexer-client.js";

const repository = createProductRepository();
const apiClient = new OpenFoodFactsApiClient();
const searchIndexer = new HttpSearchIndexerClient({
  baseUrl: config.searchIndexer.baseUrl,
  token: config.searchIndexer.token,
  searchTimeoutMs: config.searchIndexer.searchTimeoutMs,
  writeTimeoutMs: config.searchIndexer.writeTimeoutMs,
});
const lookupService = new ProductLookupService(repository, apiClient, searchIndexer, searchIndexer);

const app = express();
app.disable("x-powered-by");

app.get("/health/live", (_req, res) => res.status(200).json({ status: "ok" }));

app.get("/health/ready", (_req: Request, res: Response) => {
  void (async () => {
    const mongoAvailable = await repository.isAvailable();
    res.status(200).json({
      status: "ok",
      mongo: { available: mongoAvailable },
      offApi: { circuitOpen: apiClient.isCircuitOpen() },
    });
  })();
});

app.get("/api/v1/search", (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const query = req.query.q?.toString().trim() ?? "";
    const parsedLimit = Number(req.query.limit ?? 10);
    const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 20) : 10;
    if (query.length < 3) {
      res.status(400).json({ error: "invalid_query", message: "q must contain at least 3 characters." });
      return;
    }
    const result = await lookupService.search(query, limit, req.header("X-Trace-Id") ?? undefined);
    if (result.status === "error") {
      res.status(503).set("Retry-After", "5").json({
        error: "search_unavailable",
        message: "Open Food Facts search is temporarily unavailable.",
        reason: result.reason,
      });
      return;
    }
    res.status(200).json({
      query,
      source: result.source ?? "external",
      items: result.hits.map((hit) => ({ code: hit.code, product: hit.product })),
    });
  })().catch(next);
});

app.get("/api/v1/internal/search-source/products", (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    if (!isValidInternalToken(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (repository.listSearchSourcePage === undefined) {
      res.status(503).json({ error: "search_source_unavailable" });
      return;
    }
    const rawLimit = Number(req.query.limit ?? 500);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500;
    const cursor = req.query.cursor?.toString().trim() || undefined;
    const page = await repository.listSearchSourcePage(cursor, limit);
    if (page === undefined) {
      res.status(503).json({ error: "search_source_unavailable" });
      return;
    }
    res.status(200).json(page);
  })().catch(next);
});

app.get("/api/v1/products/:barcode", (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const barcode = req.params.barcode?.trim() ?? "";
    if (!isValidBarcode(barcode)) {
      res.status(400).json({ error: "invalid_barcode", message: "Expected 6 to 14 numeric digits." });
      return;
    }

    // source=local is deliberately a verification mode: it proves the dump alone can produce
    // the same API-shaped contract without contacting Open Food Facts.
    const localOnly = req.query.source?.toString() === "local";
    const result = await lookupService.lookup(barcode, { allowRemote: !localOnly });
    switch (result.outcome) {
      case "hit": {
        const { _cache_meta, ...product } = result.product;
        void _cache_meta;
        res.status(200).json({
          code: barcode,
          source: result.source,
          provenance: result.provenance,
          ...(result.derivedFields ? { derived: result.derivedFields } : {}),
          product,
        });
        return;
      }
      case "not_found":
        res.status(404).json({ error: "product_not_found", code: barcode });
        return;
      case "unavailable":
        res.status(503).set("Retry-After", "5").json({
          error: "lookup_unavailable",
          code: barcode,
          reason: result.reason,
        });
        return;
    }
  })().catch(next);
});

app.use((_req: Request, res: Response) => res.status(404).json({ error: "not_found" }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  log("error", "unhandled_request_error", { error: error instanceof Error ? error.message : "unknown" });
  res.status(500).json({ error: "internal_error" });
});

const server = app.listen(config.port, "0.0.0.0", () => log("info", "off_lookup_started", { port: config.port }));
process.on("uncaughtException", (error) => {
  log("error", "uncaught_exception", { error: error.message, stack: error.stack });
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
});
process.on("unhandledRejection", (reason) => log("error", "unhandled_rejection", { reason: reason instanceof Error ? reason.message : String(reason) }));

function isValidInternalToken(req: Request): boolean {
  return req.header("authorization") === `Bearer ${config.internalToken}`;
}

function shutdown(signal: string): void {
  log("info", "off_lookup_shutdown", { signal });
  server.close(() => void repository.close().finally(() => process.exit(0)));
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
