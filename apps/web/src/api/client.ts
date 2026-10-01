import {
  API_BASE_URL,
  API_TIMEOUT_MS,
  DEV_BEARER_TOKEN,
  KEYCLOAK_REALM_URL,
  KEYCLOAK_CLIENT_ID,
} from "./config.js";
import type { Envelope, ErrorEnvelope } from "./types.js";
import { describeError, reportClientError } from "../lib/errorReporter.js";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Array<Record<string, unknown>>;
  requestId?: string;
  traceId?: string;
  constructor(status: number, body: ErrorEnvelope) {
    super(body.error?.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error?.code ?? "UNKNOWN";
    this.retryable = body.error?.retryable ?? false;
    this.details = body.error?.details;
  }
}

export class NetworkUnavailableError extends Error {
  requestId?: string;
  traceId?: string;
  constructor(cause?: unknown) {
    super("The Dispensa API is not reachable.");
    this.name = "NetworkUnavailableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string | number;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

function newTraceContext(): { requestId: string; traceId: string; spanId: string } {
  const hex = (bytes: number): string => {
    const buffer = new Uint8Array(bytes);
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(buffer);
    else for (let i = 0; i < bytes; i += 1) buffer[i] = Math.floor(Math.random() * 256);
    return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  return { requestId: newIdempotencyKey(), traceId: hex(16), spanId: hex(8) };
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

interface PersistedAuthState {
  token?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
}
function readPersistedAuth(): PersistedAuthState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("dispensa-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: PersistedAuthState } | null;
    return parsed?.state ?? null;
  } catch {
    return null;
  }
}
function writePersistedAuth(patch: PersistedAuthState): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem("dispensa-auth");
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    if (!parsed.state) parsed.state = {};
    Object.assign(parsed.state, patch);
    localStorage.setItem("dispensa-auth", JSON.stringify(parsed));
  } catch (e) {
    console.error("Errore durante il salvataggio del token:", e);
  }
}

export const SESSION_EXPIRED_EVENT = "dispensa:session-expired";
export const TOKENS_REFRESHED_EVENT = "dispensa:tokens-refreshed";
function clearPersistedAuth(): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem("dispensa-auth"); } catch { /* ignore */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

let refreshPromise: Promise<string | null> | null = null;
async function ensureFreshAccessToken(): Promise<string | null> {
  const auth = readPersistedAuth();
  if (!auth?.token) return null;
  if (!auth.refreshToken || !auth.expiresAt) return auth.token;
  if (Date.now() < auth.expiresAt - 60_000) return auth.token;
  if (refreshPromise !== null) return refreshPromise;
  refreshPromise = doRefresh(auth.refreshToken).finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function doRefresh(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: KEYCLOAK_CLIENT_ID, refresh_token: refreshToken }),
    });
    if (!res.ok) { clearPersistedAuth(); return null; }
    const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    const expiresAt = Date.now() + json.expires_in * 1000;
    writePersistedAuth({ token: json.access_token, refreshToken: json.refresh_token, expiresAt });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(TOKENS_REFRESHED_EVENT, { detail: { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt } }));
    }
    return json.access_token;
  } catch {
    return readPersistedAuth()?.token ?? null;
  }
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const rawUrl = API_BASE_URL + path;
  const url = /^https?:\/\//i.test(rawUrl) ? new URL(rawUrl) : new URL(rawUrl, window.location.origin);
  if (query) for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
  return url.toString();
}

const PUBLIC_API_PATHS = new Set(["/auth/register", "/auth/reset-password"]);
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, idempotencyKey, ifMatch, query, signal } = options;
  const isPublic = PUBLIC_API_PATHS.has(path);
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  const trace = newTraceContext();
  headers.traceparent = `00-${trace.traceId}-${trace.spanId}-01`;
  headers["X-Request-Id"] = trace.requestId;
  if (method !== "GET") headers["X-Idempotency-Key"] = idempotencyKey ?? newIdempotencyKey();
  if (ifMatch !== undefined) headers["If-Match"] = String(ifMatch);
  const token = isPublic ? undefined : ((await ensureFreshAccessToken()) ?? DEV_BEARER_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const combinedSignal = signal ? anySignal([signal, controller.signal]) : controller.signal;
  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (cause) {
    const failure = new NetworkUnavailableError(cause);
    failure.requestId = trace.requestId;
    failure.traceId = trace.traceId;
    if (!signal?.aborted) reportClientError({ kind: "network_error", message: describeError(cause), apiPath: path, requestId: trace.requestId, traceId: trace.traceId });
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 204) return undefined as T;
  if (response.status === 401 && !isPublic && typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));

  let payload: unknown;
  try { payload = await response.json(); }
  catch (cause) { if (!response.ok) throw new NetworkUnavailableError(cause); return undefined as T; }
  if (!response.ok) {
    const failure = new ApiError(response.status, payload as ErrorEnvelope);
    failure.requestId = trace.requestId;
    failure.traceId = trace.traceId;
    if (response.status >= 500) reportClientError({ kind: "api_error", message: failure.message, apiPath: path, status: response.status, code: failure.code, requestId: trace.requestId, traceId: trace.traceId });
    throw failure;
  }
  if (typeof payload === "object" && payload !== null && Object.prototype.hasOwnProperty.call(payload, "data")) {
    const envelope = payload as Envelope<T> & { version?: number };
    const data = envelope.data;
    if (typeof envelope.version === "number" && data !== null && typeof data === "object" && !Array.isArray(data)) return { ...(data as Record<string, unknown>), version: envelope.version } as T;
    return data;
  }
  return payload as T;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(); break; }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
export function isBackendUnreachable(error: unknown): boolean { return error instanceof NetworkUnavailableError; }
export function isNotFound(error: unknown): boolean { return error instanceof ApiError && error.code === "NOT_FOUND_OR_NOT_VISIBLE"; }
