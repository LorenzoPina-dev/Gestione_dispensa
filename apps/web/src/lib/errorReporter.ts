/**
 * Reports browser-side failures to the gateway (`POST /api/v1/client-errors`), which writes them
 * as structured `web.client_error` log lines and counts them in `web_client_errors_total`.
 *
 * Why it exists: a request that never reaches the gateway (offline, timeout, DNS, nginx down)
 * leaves NO trace in any backend log. The browser is the only place that knows about it.
 * Every report carries the `requestId`/`traceId` the failing call used, so in Grafana you can
 * pivot from "user saw an error" to the backend logs/trace of that exact request.
 *
 * Deliberately dependency-free and never throws: a broken reporter must not break the app.
 * It uses the raw `fetch`, not `apiRequest`, so it can never trigger itself in a loop.
 */

export type ClientErrorKind =
  | "js_error"
  | "unhandled_rejection"
  | "react_render"
  | "api_error"
  | "network_error";

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  /** API path that failed, without query string (query strings can carry ids/tokens). */
  apiPath?: string;
  status?: number;
  code?: string;
  requestId?: string;
  traceId?: string;
}

const ENDPOINT = `${(import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") || "/api/v1"}/client-errors`;
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";
const MAX_REPORTS_PER_PAGE_LOAD = 20;
const DEDUPE_WINDOW_MS = 10_000;

let sent = 0;
const recent = new Map<string, number>();

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof window === "undefined" || sent >= MAX_REPORTS_PER_PAGE_LOAD) return;

    const key = `${report.kind}|${report.apiPath ?? ""}|${report.message}`;
    const now = Date.now();
    if ((recent.get(key) ?? 0) + DEDUPE_WINDOW_MS > now) return;
    recent.set(key, now);
    if (recent.size > 100) recent.clear();
    sent += 1;

    const body = JSON.stringify({
      ...report,
      message: report.message.slice(0, 500),
      stack: report.stack?.slice(0, 3000),
      page: window.location.pathname, // pathname only: no query/hash
      appVersion: APP_VERSION,
    });
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true, // survives page unload, like sendBeacon but with a JSON content-type
    }).catch(() => {
      /* the reporter must never surface its own failures */
    });
  } catch {
    /* ignore */
  }
}

/** Human-readable one-liner for an unknown thrown value. */
export function describeError(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Call once at startup (main.tsx). Captures errors nothing else caught. */
export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    // Benign browser noise, not an application fault.
    if (/ResizeObserver loop/i.test(event.message)) return;
    reportClientError({
      kind: "js_error",
      message: event.message || "Unknown script error",
      ...(event.error instanceof Error && event.error.stack ? { stack: event.error.stack } : {}),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    reportClientError({
      kind: "unhandled_rejection",
      message: describeError(reason),
      ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
    });
  });
}
