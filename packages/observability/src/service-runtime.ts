/**
 * Service runtime observability: structured JSON logs, W3C trace propagation, Prometheus metrics
 * and optional OTLP span export. Zero runtime dependencies, framework-light (Node http types only).
 *
 * SOURCE OF TRUTH: packages/observability/src/service-runtime.ts
 * Each service ships a byte-identical copy at src/observability.ts because Docker images only
 * contain the service's own workspace. After editing the source run `npm run obs:sync`;
 * `npm run obs:check` fails when a copy drifted.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";

/* ───────────────────────── configuration ───────────────────────── */

let serviceName = process.env.SERVICE_NAME ?? "unknown-service";
const version = process.env.APP_VERSION ?? "dev";
const environment = process.env.APP_ENV ?? "local";
const logLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const otlpEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").replace(/\/+$/, "");
const slowRequestMs = Number(process.env.OBS_SLOW_REQUEST_MS ?? 2000);
const slowQueryMs = Number(process.env.OBS_SLOW_QUERY_MS ?? 500);
const captureBodyOn5xx = (process.env.OBS_CAPTURE_BODY_ON_5XX ?? "true") !== "false";
const otlpInitialDelayMs = Math.max(0, Number(process.env.OBS_OTLP_INITIAL_DELAY_MS ?? 10000));
const otlpRetryBaseMs = Math.max(1000, Number(process.env.OBS_OTLP_RETRY_BASE_MS ?? 5000));
const otlpRetryMaxMs = Math.max(otlpRetryBaseMs, Number(process.env.OBS_OTLP_RETRY_MAX_MS ?? 60000));

export type Fields = Record<string, unknown>;
type Next = (err?: unknown) => void;
type HttpReq = IncomingMessage & {
  originalUrl?: string;
  baseUrl?: string;
  route?: { path?: unknown };
  body?: unknown;
  query?: unknown;
};
type HttpRes = ServerResponse & { json?: (body?: unknown) => unknown };

/* ───────────────────────── request context ───────────────────────── */

export interface ObsContext {
  requestId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  userId?: string;
  familyId?: string;
  upstream?: string;
  errorCode?: string;
  errorMessage?: string;
  error?: Fields;
}

const storage = new AsyncLocalStorage<ObsContext>();
const contexts = new WeakMap<object, ObsContext>();
const hex = (bytes: number): string => randomBytes(bytes).toString("hex");
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i;

export function currentContext(): ObsContext | undefined {
  return storage.getStore();
}

export function currentTraceparent(): string | undefined {
  const ctx = storage.getStore();
  return ctx ? `00-${ctx.traceId}-${ctx.spanId}-01` : undefined;
}

/** Adds identity/provenance to the current request context (logs only, never metric labels). */
export function annotate(fields: { userId?: string; familyId?: string; upstream?: string }): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (fields.userId !== undefined) ctx.userId = fields.userId;
  if (fields.familyId !== undefined) ctx.familyId = fields.familyId;
  if (fields.upstream !== undefined) ctx.upstream = fields.upstream;
}

export function parseTraceparent(value: unknown): { traceId: string; spanId: string } | undefined {
  if (typeof value !== "string") return undefined;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  const traceId = match?.[1];
  const spanId = match?.[2];
  if (!traceId || !spanId || /^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  return { traceId: traceId.toLowerCase(), spanId: spanId.toLowerCase() };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/* ───────────────────────── logging ───────────────────────── */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const SENSITIVE_KEY = /(token|secret|password|passwd|cookie|authorization|api[-_]?key|prompt|image|email|phone|code_verifier)/i;

function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object" || value === null) return value;
  if (depth >= 5) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const out: Fields = {};
  for (const [key, item] of Object.entries(value).slice(0, 50)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1);
  }
  return out;
}

/** Free-text errors can echo secrets (connection strings, bearer tokens): scrub before they reach a log. */
const scrub = (text: string): string =>
  text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/(password|passwd|secret|token|api[-_]?key|authorization)(["']?\s*[=:]\s*["']?)(?!Bearer \[REDACTED\])[^\s"',;&]+/gi, "$1$2[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@");

export function serializeError(error: unknown, depth = 0): Fields {
  if (!(error instanceof Error)) {
    return { message: typeof error === "string" ? error.slice(0, 1000) : String(JSON.stringify(redact(error))).slice(0, 1000) };
  }
  const source = error as Error & Record<string, unknown>;
  const out: Fields = { name: error.name, message: scrub(error.message).slice(0, 1000) };
  // Diagnostic-only properties (pg SQLSTATE, Node errno, http status). pg `detail` is skipped: it can echo row values.
  for (const key of ["code", "status", "errno", "syscall", "hostname", "severity", "schema", "table", "column", "constraint", "routine"]) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  if (error.stack) out.stack = scrub(error.stack).slice(0, 3500);
  if (source.cause !== undefined && depth < 3) out.cause = serializeError(source.cause, depth + 1);
  return out;
}

function write(level: Level, event: string, fields: Fields = {}, err?: unknown): void {
  if (LEVELS[level] < (LEVELS[logLevel as Level] ?? LEVELS.info)) return;
  const ctx = storage.getStore();
  const record: Fields = {
    ...(redact(fields) as Fields),
    ts: new Date().toISOString(),
    level,
    service: serviceName,
    version,
    env: environment,
    event,
    ...(ctx
      ? {
          requestId: ctx.requestId,
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          ...(ctx.userId ? { userId: ctx.userId } : {}),
          ...(ctx.familyId ? { familyId: ctx.familyId } : {}),
        }
      : {}),
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  };
  try {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ ts: record.ts, level, service: serviceName, event, logSerializationFailed: true })}\n`);
  }
}

export const log = {
  debug: (event: string, fields?: Fields, err?: unknown): void => write("debug", event, fields, err),
  info: (event: string, fields?: Fields, err?: unknown): void => write("info", event, fields, err),
  warn: (event: string, fields?: Fields, err?: unknown): void => write("warn", event, fields, err),
  error: (event: string, fields?: Fields, err?: unknown): void => write("error", event, fields, err),
};

const lastWarn = new Map<string, number>();
function warnRateLimited(event: string, err: unknown): void {
  const now = Date.now();
  if ((lastWarn.get(event) ?? 0) + 60_000 > now) return;
  lastWarn.set(event, now);
  log.warn(event, {}, err);
}

/* ───────────────────────── metrics (Prometheus text format) ───────────────────────── */

type LabelSet = Record<string, string | number | undefined>;
interface Series { labels: string[]; value: number; sum: number; counts: number[] }
interface Family {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  labelNames: readonly string[];
  buckets: readonly number[];
  series: Map<string, Series>;
}

const MAX_SERIES_PER_METRIC = 2000;
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const families = new Map<string, Family>();
let droppedSeries = 0;

function getFamily(name: string, help: string, type: Family["type"], labelNames: readonly string[], buckets: readonly number[]): Family {
  const existing = families.get(name);
  if (existing) return existing;
  const created: Family = { name, help, type, labelNames, buckets, series: new Map() };
  families.set(name, created);
  return created;
}

function seriesFor(family: Family, labels: LabelSet): Series | undefined {
  const values = family.labelNames.map((name) => String(labels[name] ?? ""));
  const key = values.join("\u0001");
  let series = family.series.get(key);
  if (!series) {
    if (family.series.size >= MAX_SERIES_PER_METRIC) {
      droppedSeries += 1; // cardinality guard: never let a bad label take the service down
      return undefined;
    }
    series = { labels: values, value: 0, sum: 0, counts: new Array<number>(family.buckets.length).fill(0) };
    family.series.set(key, series);
  }
  return series;
}

export const metrics = {
  counter(name: string, help: string, labelNames: readonly string[] = []) {
    const family = getFamily(name, help, "counter", labelNames, []);
    return {
      inc(labels: LabelSet = {}, by = 1): void {
        const series = seriesFor(family, labels);
        if (series) series.value += by;
      },
    };
  },
  gauge(name: string, help: string, labelNames: readonly string[] = []) {
    const family = getFamily(name, help, "gauge", labelNames, []);
    return {
      set(labels: LabelSet, value: number): void {
        const series = seriesFor(family, labels);
        if (series) series.value = value;
      },
      add(labels: LabelSet, delta: number): void {
        const series = seriesFor(family, labels);
        if (series) series.value += delta;
      },
    };
  },
  histogram(name: string, help: string, labelNames: readonly string[] = [], buckets: readonly number[] = DEFAULT_BUCKETS) {
    const family = getFamily(name, help, "histogram", labelNames, buckets);
    return {
      observe(labels: LabelSet, value: number): void {
        const series = seriesFor(family, labels);
        if (!series) return;
        series.value += 1;
        series.sum += value;
        const index = family.buckets.findIndex((bound) => value <= bound);
        if (index >= 0) series.counts[index] = (series.counts[index] ?? 0) + 1;
      },
    };
  },
};

const escapeLabel = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
const braces = (parts: string[]): string => (parts.length ? `{${parts.join(",")}}` : "");

const httpRequests = metrics.counter("http_requests_total", "HTTP requests handled.", ["method", "route", "status"]);
const httpDuration = metrics.histogram("http_request_duration_seconds", "HTTP request latency.", ["method", "route", "status_class"]);
const httpInFlight = metrics.gauge("http_requests_in_flight", "HTTP requests currently being served.");
const httpErrors = metrics.counter("http_errors_total", "HTTP error responses by domain error code.", ["route", "status", "code"]);
const outboundRequests = metrics.counter("outbound_requests_total", "Outbound HTTP calls to other services or providers.", ["target", "method", "outcome"]);
const outboundDuration = metrics.histogram("outbound_request_duration_seconds", "Outbound HTTP call latency.", ["target"]);
const dbDuration = metrics.histogram("db_query_duration_seconds", "PostgreSQL query latency.", ["operation"]);
const dbErrors = metrics.counter("db_errors_total", "PostgreSQL query failures by SQLSTATE.", ["operation", "code"]);
const fatalErrors = metrics.counter("process_fatal_errors_total", "Uncaught exceptions / unhandled rejections.", ["type"]);
const spansDropped = metrics.counter("otel_spans_dropped_total", "Spans dropped before reaching the collector.", ["reason"]);

const pools: Array<() => { total: number; idle: number; waiting: number }> = [];
export function registerPool(read: () => { total: number; idle: number; waiting: number }): void {
  pools.push(read);
}

const loopDelay = monitorEventLoopDelay({ resolution: 20 });

function runtimeLines(): string[] {
  const lines: string[] = [];
  const add = (name: string, type: string, help: string, value: number, labels = ""): void => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}${labels} ${Number.isFinite(value) ? value : 0}`);
  };
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  add("process_cpu_seconds_total", "counter", "User plus system CPU time.", (cpu.user + cpu.system) / 1e6);
  add("process_resident_memory_bytes", "gauge", "Resident set size.", memory.rss);
  add("nodejs_heap_used_bytes", "gauge", "V8 heap used.", memory.heapUsed);
  add("nodejs_heap_total_bytes", "gauge", "V8 heap total.", memory.heapTotal);
  add("process_start_time_seconds", "gauge", "Process start time (unix).", Math.floor(Date.now() / 1000 - process.uptime()));
  add("nodejs_eventloop_lag_p99_seconds", "gauge", "Event loop delay p99 since last scrape.", loopDelay.percentile(99) / 1e9);
  add("nodejs_active_resources", "gauge", "Active libuv resources.", process.getActiveResourcesInfo().length);
  add("obs_dropped_series_total", "counter", "Metric series rejected by the cardinality guard.", droppedSeries);
  add("app_info", "gauge", "Build information.", 1, `{service="${escapeLabel(serviceName)}",version="${escapeLabel(version)}",env="${escapeLabel(environment)}"}`);
  loopDelay.reset();
  if (pools.length) {
    lines.push("# HELP db_pool_connections PostgreSQL pool connections by state.", "# TYPE db_pool_connections gauge");
    pools.forEach((read, pool) => {
      const snapshot = read();
      for (const state of ["total", "idle", "waiting"] as const) lines.push(`db_pool_connections{pool="${pool}",state="${state}"} ${snapshot[state]}`);
    });
  }
  return lines;
}

export function renderMetrics(): string {
  const out: string[] = [];
  for (const family of families.values()) {
    out.push(`# HELP ${family.name} ${family.help}`, `# TYPE ${family.name} ${family.type}`);
    for (const series of family.series.values()) {
      const base = family.labelNames.map((name, index) => `${name}="${escapeLabel(series.labels[index] ?? "")}"`);
      if (family.type !== "histogram") {
        out.push(`${family.name}${braces(base)} ${series.value}`);
        continue;
      }
      let cumulative = 0;
      family.buckets.forEach((bound, index) => {
        cumulative += series.counts[index] ?? 0;
        out.push(`${family.name}_bucket${braces([...base, `le="${bound}"`])} ${cumulative}`);
      });
      out.push(
        `${family.name}_bucket${braces([...base, 'le="+Inf"'])} ${series.value}`,
        `${family.name}_sum${braces(base)} ${series.sum}`,
        `${family.name}_count${braces(base)} ${series.value}`,
      );
    }
  }
  return `${[...out, ...runtimeLines()].join("\n")}\n`;
}

export function metricsHandler(_req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
  res.end(renderMetrics());
}

/* ───────────────────────── spans (optional OTLP/HTTP export → collector → Tempo) ───────────────────────── */

interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 2 | 3;
  startMs: number;
  endMs: number;
  attrs: Record<string, string | number>;
  error: boolean;
}

const spanBuffer: SpanRecord[] = [];
let rawFetch: typeof fetch | undefined;
let otlpConsecutiveFailures = 0;
let otlpRetryAt = 0;
let otlpFlushInFlight = false;

function emitSpan(span: SpanRecord): void {
  if (!otlpEndpoint) return;
  if (spanBuffer.length >= 2000) {
    spansDropped.inc({ reason: "buffer_full" });
    return;
  }
  spanBuffer.push(span);
}

async function flushSpans(): Promise<void> {
  if (!otlpEndpoint || !rawFetch || spanBuffer.length === 0) return;
  // Rispetta il backoff calcolato dopo un errore e non sovrapporre i flush: senza questi controlli, con il
  // collector irraggiungibile partiva un fetch ogni 2s e ogni lookup DNS pendente (5s, non annullabile)
  // occupava un thread del pool libuv, affamando le risoluzioni DNS delle chiamate verso gli altri servizi.
  if (otlpFlushInFlight || Date.now() < otlpRetryAt) return;
  otlpFlushInFlight = true;
  const batch = spanBuffer.splice(0, 256);
  const attribute = (key: string, value: string | number) => ({
    key,
    value: typeof value === "number" ? { intValue: String(Math.trunc(value)) } : { stringValue: value },
  });
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [attribute("service.name", serviceName), attribute("service.version", version), attribute("deployment.environment", environment)] },
        scopeSpans: [
          {
            scope: { name: "dispensa-observability" },
            spans: batch.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: span.kind,
              startTimeUnixNano: (BigInt(span.startMs) * 1_000_000n).toString(),
              endTimeUnixNano: (BigInt(span.endMs) * 1_000_000n).toString(),
              attributes: Object.entries(span.attrs).map(([key, value]) => attribute(key, value)),
              status: { code: span.error ? 2 : 1 },
            })),
          },
        ],
      },
    ],
  };
  try {
    const response = await rawFetch(`${otlpEndpoint}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
    void response.body?.cancel();
    if (!response.ok) throw new Error(`OTLP collector answered ${response.status}`);
    otlpConsecutiveFailures = 0;
    otlpRetryAt = 0;
  } catch (error) {
    otlpConsecutiveFailures += 1;
    const delayMs = Math.min(
      otlpRetryMaxMs,
      otlpRetryBaseMs * 2 ** Math.min(otlpConsecutiveFailures - 1, 10),
    );
    otlpRetryAt = Date.now() + delayMs;

    // Telemetry is optional. Keep the failed batch in the bounded in-memory buffer so a
    // temporary collector startup/restart does not silently lose spans. If the buffer is full,
    // emitSpan() will drop new spans under the existing cardinality-independent buffer guard.
    spanBuffer.unshift(...batch);
    warnRateLimited("otel.export_failed", error);
  } finally {
    otlpFlushInFlight = false;
  }
}

/* ───────────────────────── inbound HTTP ───────────────────────── */

function setErrorInfo(ctx: ObsContext, code: unknown, message: unknown): void {
  if (typeof code === "string") ctx.errorCode = /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : "OTHER";
  else if (code !== undefined && code !== null) ctx.errorCode = "OTHER";
  if (typeof message === "string") ctx.errorMessage = scrub(message).slice(0, 300);
}

/** Lets a proxy copy the upstream error code/message into this hop's access log. */
export function noteUpstreamError(code: unknown, message: unknown): void {
  const ctx = storage.getStore();
  if (ctx) setErrorInfo(ctx, code, message);
}

/** Attaches the failure that produced an error response to the request's single access-log line. */
export function recordError(error: unknown, options: { status?: number } = {}): void {
  const ctx = storage.getStore();
  if (!ctx) {
    log.error("error.unscoped", {}, error);
    return;
  }
  const serialized = serializeError(error);
  if (options.status !== undefined && options.status < 500) delete serialized.stack; // handled domain errors: no stack noise
  if (!ctx.error || serialized.stack !== undefined) ctx.error = serialized;
}

function captureErrorBody(ctx: ObsContext, body: unknown): void {
  if (typeof body !== "object" || body === null) return;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") setErrorInfo(ctx, error, (body as { message?: unknown }).message);
  else if (typeof error === "object" && error !== null) setErrorInfo(ctx, (error as { code?: unknown }).code, (error as { message?: unknown }).message);
}

/** First middleware: builds the trace/request context and emits one access-log line + metrics per request. */
export function requestObservability() {
  return (req: HttpReq, res: HttpRes, next: Next): void => {
    const incoming = parseTraceparent(header(req, "traceparent"));
    const legacyTrace = header(req, "x-trace-id");
    const requestId = header(req, "x-request-id");
    const familyId = header(req, "x-family-id");
    const ctx: ObsContext = {
      requestId: requestId && ID_PATTERN.test(requestId) ? requestId : randomUUID(),
      traceId: incoming?.traceId ?? (legacyTrace && /^[0-9a-f]{32}$/i.test(legacyTrace) ? legacyTrace.toLowerCase() : hex(16)),
      spanId: hex(8),
      ...(incoming ? { parentSpanId: incoming.spanId } : {}),
      ...(familyId && ID_PATTERN.test(familyId) ? { familyId } : {}),
    };
    // Downstream envelope code already reads these two headers, so ids stay consistent everywhere.
    req.headers["x-request-id"] = ctx.requestId;
    req.headers["x-trace-id"] = ctx.traceId;
    res.setHeader("x-request-id", ctx.requestId);
    res.setHeader("traceparent", `00-${ctx.traceId}-${ctx.spanId}-01`);
    contexts.set(req, ctx);

    if (typeof res.json === "function") {
      const original = res.json.bind(res);
      res.json = (body?: unknown): unknown => {
        captureErrorBody(ctx, body);
        return original(body);
      };
    }

    const startedAt = Date.now();
    const started = process.hrtime.bigint();
    let closed = false;
    httpInFlight.add({}, 1);
    res.on("close", () => {
      if (closed) return;
      closed = true;
      httpInFlight.add({}, -1);
      finalize(req, res, ctx, started, startedAt, res.writableFinished);
    });
    storage.enterWith(ctx);
    next();
  };
}

/** Put right after body parsers: stream callbacks can drop AsyncLocalStorage, this restores it. */
export function rebindContext() {
  return (req: HttpReq, _res: HttpRes, next: Next): void => {
    const ctx = contexts.get(req);
    if (ctx) storage.enterWith(ctx);
    next();
  };
}

function finalize(req: HttpReq, res: HttpRes, ctx: ObsContext, started: bigint, startedAt: number, finished: boolean): void {
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const status = finished ? res.statusCode : 499; // 499 = client went away before we answered
  const path = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
  const quiet = path === "/metrics" || path.startsWith("/health/");
  const route = req.route ? `${req.baseUrl ?? ""}${String(req.route.path)}` : req.baseUrl || "unmatched";
  const method = req.method ?? "GET";

  if (!quiet || status >= 500) {
    httpRequests.inc({ method, route, status });
    httpDuration.observe({ method, route, status_class: `${Math.floor(status / 100)}xx` }, seconds);
    if (status >= 400) httpErrors.inc({ route, status, code: ctx.errorCode ?? (status === 499 ? "CLIENT_CLOSED" : "UNKNOWN") });
  }
  emitSpan({
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    ...(ctx.parentSpanId ? { parentSpanId: ctx.parentSpanId } : {}),
    name: `${method} ${route}`,
    kind: 2,
    startMs: startedAt,
    endMs: Date.now(),
    attrs: { "http.request.method": method, "http.route": route, "url.path": path, "http.response.status_code": status, "dispensa.request_id": ctx.requestId, ...(ctx.errorCode ? { "dispensa.error_code": ctx.errorCode } : {}) },
    error: status >= 500,
  });

  const durationMs = Math.round(seconds * 1000 * 10) / 10;
  const slow = durationMs >= slowRequestMs;
  if (quiet && status < 400) return;
  const level: Level = status >= 500 ? "error" : status >= 400 || slow ? "warn" : "info";
  const forwarded = header(req, "x-forwarded-for")?.split(",")[0]?.trim();
  const fields: Fields = {
    method,
    path,
    route,
    status,
    durationMs,
    ip: forwarded ?? req.socket?.remoteAddress,
    userAgent: header(req, "user-agent")?.slice(0, 200),
    ...(slow ? { slow: true } : {}),
    ...(ctx.parentSpanId ? { parentSpanId: ctx.parentSpanId } : {}),
    ...(ctx.errorCode ? { errorCode: ctx.errorCode } : {}),
    ...(ctx.errorMessage ? { errorMessage: ctx.errorMessage } : {}),
    ...(ctx.upstream ? { upstream: ctx.upstream } : {}),
    ...(ctx.error ? { err: ctx.error } : {}),
  };
  if (status >= 500 && captureBodyOn5xx) {
    // Redacted + truncated inputs so a 5xx can be replayed against a dev stack.
    fields.requestQuery = req.query;
    fields.requestBody = JSON.stringify(redact(req.body) ?? null).slice(0, 4096);
  }
  storage.run(ctx, () => write(level, "http.request", fields));
}

/** Last middleware: turns thrown/forwarded errors into the JSON envelope the web client expects. */
export function errorMiddleware() {
  return (error: unknown, req: HttpReq, res: HttpRes, next: Next): void => {
    const ctx = contexts.get(req);
    if (ctx) storage.enterWith(ctx);
    const raw = typeof error === "object" && error !== null ? (error as { status?: unknown; statusCode?: unknown }) : {};
    const candidate = typeof raw.status === "number" ? raw.status : typeof raw.statusCode === "number" ? raw.statusCode : 500;
    const status = candidate >= 400 && candidate < 600 ? candidate : 500;
    recordError(error, { status });
    if (res.headersSent) {
      next(error);
      return;
    }
    const code = status === 413 ? "PAYLOAD_TOO_LARGE" : status < 500 ? "BAD_REQUEST" : "INTERNAL_ERROR";
    if (ctx) ctx.errorCode = code;
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: { code, message: status < 500 ? "The request could not be processed." : "Internal server error.", retryable: false, details: [] },
        meta: { requestId: ctx?.requestId ?? "", traceId: ctx?.traceId ?? "", schemaVersion: "1.0" },
      }),
    );
  };
}

/* ───────────────────────── outbound HTTP (global fetch instrumentation) ───────────────────────── */

const isInternalHost = (host: string): boolean =>
  !host.includes(".") || host === "localhost" || host.endsWith(".local") || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);

function patchFetch(): void {
  const original = globalThis.fetch;
  if (typeof original !== "function" || rawFetch) return;
  rawFetch = original.bind(globalThis);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const ctx = storage.getStore();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let url: URL | undefined;
    try {
      url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    } catch {
      url = undefined;
    }
    const target = url?.host ?? "unknown";
    const spanId = hex(8);
    const traceId = ctx?.traceId ?? hex(16);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // Trace context is only sent to internal hosts; third-party providers get nothing extra.
    if (url && isInternalHost(url.hostname)) {
      if (!headers.has("traceparent")) headers.set("traceparent", `00-${traceId}-${spanId}-01`);
      if (ctx && !headers.has("x-request-id")) headers.set("x-request-id", ctx.requestId);
    }
    const startedAt = Date.now();
    const started = process.hrtime.bigint();
    const finish = (outcome: string, status?: number): number => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      outboundRequests.inc({ target, method, outcome });
      outboundDuration.observe({ target }, seconds);
      emitSpan({
        traceId,
        spanId,
        ...(ctx ? { parentSpanId: ctx.spanId } : {}),
        name: `HTTP ${method} ${target}`,
        kind: 3,
        startMs: startedAt,
        endMs: Date.now(),
        attrs: { "http.request.method": method, "server.address": target, ...(url ? { "url.path": url.pathname } : {}), ...(status !== undefined ? { "http.response.status_code": status } : {}) },
        error: outcome === "error" || outcome === "timeout" || outcome === "5xx",
      });
      return Math.round(seconds * 1000 * 10) / 10;
    };
    try {
      const response = await original(input, { ...init, headers });
      const outcome = `${Math.floor(response.status / 100)}xx`;
      const durationMs = finish(outcome, response.status);
      if (response.status >= 500) log.warn("outbound.error_response", { target, method, path: url?.pathname, status: response.status, durationMs });
      return response;
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      const outcome = name === "TimeoutError" || name === "AbortError" ? "timeout" : "error";
      const durationMs = finish(outcome);
      log.error("outbound.failed", { target, method, path: url?.pathname, outcome, durationMs }, error);
      throw error;
    }
  }) as typeof fetch;
}

/* ───────────────────────── database ───────────────────────── */

const sqlOperation = (sql: string): string => {
  const word = sql.trimStart().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
  return ["SELECT", "INSERT", "UPDATE", "DELETE", "WITH", "BEGIN", "COMMIT", "ROLLBACK"].includes(word) ? word : "OTHER";
};

/** Wraps a query: latency histogram, slow-query warning, and a structured error with the SQLSTATE. */
export async function traceDb<T>(sql: string, run: () => Promise<T>): Promise<T> {
  const operation = sqlOperation(sql);
  const started = process.hrtime.bigint();
  const elapsedMs = (): number => Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 10) / 10;
  const snippet = sql.replace(/\s+/g, " ").trim().slice(0, 200); // parameters are never logged
  try {
    const result = await run();
    dbDuration.observe({ operation }, Number(process.hrtime.bigint() - started) / 1e9);
    const durationMs = elapsedMs();
    if (durationMs >= slowQueryMs) log.warn("db.slow_query", { operation, durationMs, sql: snippet });
    return result;
  } catch (error) {
    dbDuration.observe({ operation }, Number(process.hrtime.bigint() - started) / 1e9);
    const code = String((error as { code?: unknown } | null)?.code ?? "unknown");
    dbErrors.inc({ operation, code });
    // SQLSTATE class 23 = integrity violation (duplicate, FK): expected business outcome, not an outage.
    (code.startsWith("23") ? log.warn : log.error)("db.query_failed", { operation, sqlstate: code, durationMs: elapsedMs(), sql: snippet }, error);
    throw error;
  }
}

/* ───────────────────────── lifecycle ───────────────────────── */

/** Runs `fn` as a traced unit of work (queue consumer, cron job) continuing an optional upstream trace. */
export async function runWithTrace<T>(name: string, carrier: { traceparent?: string; requestId?: string }, fn: () => Promise<T>): Promise<T> {
  const parent = parseTraceparent(carrier.traceparent);
  const ctx: ObsContext = {
    requestId: carrier.requestId && ID_PATTERN.test(carrier.requestId) ? carrier.requestId : randomUUID(),
    traceId: parent?.traceId ?? hex(16),
    spanId: hex(8),
    ...(parent ? { parentSpanId: parent.spanId } : {}),
  };
  const startMs = Date.now();
  let failed = false;
  try {
    return await storage.run(ctx, fn);
  } catch (error) {
    failed = true;
    storage.run(ctx, () => log.error("job.failed", { job: name }, error));
    throw error;
  } finally {
    emitSpan({
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      ...(ctx.parentSpanId ? { parentSpanId: ctx.parentSpanId } : {}),
      name,
      kind: 2,
      startMs,
      endMs: Date.now(),
      attrs: { "dispensa.request_id": ctx.requestId },
      error: failed,
    });
  }
}

let started = false;

/** Call once at the top of the service entrypoint, before any other work. */
export function startObservability(name: string, options: { exitOnUnhandledRejection?: boolean } = {}): void {
  if (started) return;
  started = true;
  serviceName = name;
  loopDelay.enable();
  patchFetch();
  if (otlpEndpoint) {
    // Do not race the collector during normal Docker startup. The retry path below also covers
    // collectors that restart later without coupling application readiness to telemetry.
    const firstFlush = setTimeout(() => void flushSpans(), otlpInitialDelayMs);
    firstFlush.unref();
    setInterval(() => void flushSpans(), 2000).unref();
  }
  const fatal = (type: string, exit: boolean) => (reason: unknown): void => {
    fatalErrors.inc({ type });
    log.error("process.fatal", { type, willExit: exit }, reason);
    if (exit) setTimeout(() => process.exit(1), 300); // same crash-and-restart semantics as before, but with a structured trace first
  };
  process.on("uncaughtException", fatal("uncaughtException", true));
  process.on("unhandledRejection", fatal("unhandledRejection", options.exitOnUnhandledRejection !== false));
  log.info("service.starting", { pid: process.pid, node: process.version, otlp: otlpEndpoint || undefined });
}
