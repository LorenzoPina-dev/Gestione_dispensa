import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OpenSearchOffIndex, toOffSearchDocument, type OffSearchDocument, rankOffSearchHits } from "./off-search.js";
import { OffSourceSync } from "./source-sync.js";

const port = positiveInt(process.env.PORT, 3210);
const openSearchUrl = stringEnv("OPENSEARCH_URL", "http://opensearch:9200");
const internalToken = stringEnv("SEARCH_INDEXER_INTERNAL_TOKEN", "dispensa-internal-dev");
const sourceUrl = stringEnv("OFF_LOOKUP_SOURCE_URL", "http://off-lookup:3200");
const sourceToken = stringEnv("OFF_LOOKUP_SOURCE_TOKEN", internalToken);
const timeoutMs = positiveInt(process.env.OPENSEARCH_TIMEOUT_MS, 1500);
const sourceTimeoutMs = positiveInt(process.env.OFF_LOOKUP_SOURCE_TIMEOUT_MS, 3000);
const bootstrapDelayMs = positiveInt(process.env.OFF_SEARCH_BOOTSTRAP_DELAY_MS, 3000);
const bootstrapEnabled = process.env.OFF_SEARCH_BOOTSTRAP_ENABLED !== "false";
const index = new OpenSearchOffIndex(openSearchUrl, undefined, timeoutMs);
const sourceSync = new OffSourceSync(index, {
  sourceUrl,
  token: sourceToken,
  batchSize: positiveInt(process.env.OFF_SEARCH_BOOTSTRAP_BATCH_SIZE, 500),
  timeoutMs: sourceTimeoutMs,
  batchDelayMs: positiveInt(process.env.OFF_SEARCH_BOOTSTRAP_BATCH_DELAY_MS, 500),
  maxBatchesPerRun: positiveInt(process.env.OFF_SEARCH_BOOTSTRAP_MAX_BATCHES_PER_RUN, 50),
});

const app = createServer((req, res) => {
  void handle(req, res).catch((error) => {
    console.error(JSON.stringify({
      service: "search-indexer",
      event: "request_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
    sendJson(res, 500, { error: "internal_error" });
  });
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";

  if (url.pathname === "/health/live" && method === "GET") {
    sendJson(res, 200, { status: "ok", service: "search-indexer" });
    return;
  }

  if (url.pathname === "/health/ready" && method === "GET") {
    const available = await index.isAvailable();
    sendJson(res, available ? 200 : 503, { status: available ? "ready" : "not_ready", opensearch: { available } });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (url.pathname === "/api/v1/off/products/search" && method === "GET") {
    const query = (url.searchParams.get("q") ?? "").trim();
    const rawLimit = Number(url.searchParams.get("limit") ?? 8);
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 20) : 8;

    if (query.length < 3 || query.length > 120) {
      sendJson(res, 400, { error: "invalid_query", message: "q must contain 3-120 characters." });
      return;
    }

    const result = await index.search(query, limit);
    if (result.status === "unavailable") {
      sendJson(res, 503, { error: "search_unavailable", reason: result.reason });
      return;
    }

    sendJson(res, 200, { query, items: result.hits.map((hit) => ({ code: hit.code, product: hit.product })) });
    return;
  }

  if (url.pathname.startsWith("/api/v1/off/products/") && method === "PUT") {
    const code = decodeURIComponent(url.pathname.slice("/api/v1/off/products/".length)).trim();
    if (!/^\d{8,14}$/.test(code)) {
      sendJson(res, 400, { error: "invalid_barcode" });
      return;
    }
    const body = await readJson(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "invalid_body" });
      return;
    }

    const product = (body as Record<string, unknown>).product;
    if (!product || typeof product !== "object" || Array.isArray(product)) {
      sendJson(res, 400, { error: "invalid_product" });
      return;
    }

    const document = toOffSearchDocument({ code, product: product as Record<string, unknown> });
    if (!document) {
      sendJson(res, 422, { error: "product_name_required" });
      return;
    }

    await index.upsert(document);
    sendJson(res, 204, undefined);
    return;
  }

  if (url.pathname === "/api/v1/off/products/reindex" && method === "POST") {
    if (sourceSync.isRunning) {
      sendJson(res, 409, { error: "reindex_in_progress" });
      return;
    }
    void sourceSync.forceRebuild().catch((error) => {
      console.error(JSON.stringify({
        service: "search-indexer",
        event: "off_index_rebuild_failed",
        error: error instanceof Error ? error.message : "unknown",
      }));
    });
    sendJson(res, 202, { status: "started" });
    return;
  }

  if (url.pathname === "/api/v1/off/index/status" && method === "GET") {
    let count = 0;
    try {
      count = await index.count();
    } catch {
      sendJson(res, 503, { error: "index_unavailable" });
      return;
    }
    sendJson(res, 200, { index: "off-products-v1", documentCount: count, rebuilding: sourceSync.isRunning });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

function isAuthorized(req: IncomingMessage): boolean {
  const provided = req.headers.authorization;
  return typeof provided === "string" && provided === `Bearer ${internalToken}`;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    if (Buffer.concat(chunks).length > 2_000_000) throw new Error("request_body_too_large");
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204) {
    res.statusCode = 204;
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stringEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw?.trim() ? raw.trim() : fallback;
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ service: "search-indexer", event: "started", port }));
  if (bootstrapEnabled) {
    setTimeout(() => { void sourceSync.ensureBootstrapped(); }, bootstrapDelayMs).unref();
  }
  const retryTimer = setInterval(() => {
    if (bootstrapEnabled) void sourceSync.ensureBootstrapped();
  }, positiveInt(process.env.OFF_SEARCH_BOOTSTRAP_RETRY_MS, 30_000));
  retryTimer.unref();
});

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ service: "search-indexer", event: "shutdown", signal }));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.exit(0);
}
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
