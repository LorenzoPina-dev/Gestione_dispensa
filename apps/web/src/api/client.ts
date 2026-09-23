import { API_BASE_URL, API_TIMEOUT_MS, DEV_BEARER_TOKEN } from "./config.js";
import type { Envelope, ErrorEnvelope } from "./types.js";

/**
 * Thrown for any request that reached the server and came back as a documented error envelope
 * (`{ error, meta }`). Carries the machine-readable `code` so callers can branch on
 * VERSION_CONFLICT, NOT_FOUND_OR_NOT_VISIBLE, etc.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Array<Record<string, unknown>>;

  constructor(status: number, body: ErrorEnvelope) {
    super(body.error?.message || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error?.code ?? "UNKNOWN";
    this.retryable = body.error?.retryable ?? false;
    this.details = body.error?.details;
  }
}

/**
 * Thrown when the request never reached the server at all (network failure, timeout, DNS,
 * connection refused). This is the signal hooks use to fall back to demo/mock data — it means
 * "the backend isn't up", not "the backend rejected the request".
 */
export class NetworkUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The Dispensa API is not reachable.");
    this.name = "NetworkUnavailableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Required by mutating endpoints (create/movement/invite create, ...). */
  idempotencyKey?: string;
  /** Required by version-checked endpoints (inventory movements use this as the version check). */
  ifMatch?: string | number;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

/** Generates a client-side idempotency key / clientOperationId (UUID v4-ish, no backend dependency). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Legge il token dallo storage persistito dal middleware `persist` di Zustand
 * (chiave `dispensa-auth`, formato `{ state: { token, user, isAuthenticated }, version: 0 }`).
 *
 * Tenuto qui invece che importare `useAuthStore` per evitare il ciclo di import
 * `client.ts → store/auth.ts → api/endpoints.ts → client.ts`, che in fase di
 * bundling ESM può causare "Cannot access 'useAuthStore' before initialization".
 */
function readPersistedToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("dispensa-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } } | null;
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

/** Nome del CustomEvent emesso quando una risposta 401 forza la fine della sessione. */
export const SESSION_EXPIRED_EVENT = "dispensa:session-expired";

/**
 * Rimuove lo storage di auth (usato su 401 per forzare re-autenticazione) e notifica il resto
 * dell'app con un evento DOM, così lo stato Zustand in memoria (isAuthenticated/token/user) può
 * essere allineato a quello che è appena stato cancellato da localStorage — vedi il listener in
 * store/auth.ts. Senza questo evento, prima, l'app restava convinta in memoria di essere ancora
 * autenticata mentre ogni richiesta successiva partiva senza token (perché apiRequest rilegge
 * sempre localStorage), causando una cascata di 401 silenziosi invece di un chiaro "sessione
 * scaduta, accedi di nuovo".
 */
function clearPersistedAuth(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem("dispensa-auth");
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(API_BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Low-level request helper. Resolves with the parsed `data` field of a success envelope.
 * Throws `ApiError` for documented error envelopes and `NetworkUnavailableError` when the
 * backend cannot be reached at all (used by hooks to switch into demo mode).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, idempotencyKey, ifMatch, query, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (ifMatch !== undefined) headers["If-Match"] = String(ifMatch);
  const token = readPersistedToken() ?? DEV_BEARER_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const combinedSignal = signal ? anySignal([signal, controller.signal]) : controller.signal;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (cause) {
    throw new NetworkUnavailableError(cause);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) return undefined as T;

  if (response.status === 401) {
    // Rimuove il token scaduto/non valido per forzare re-autenticazione.
    clearPersistedAuth();
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    if (!response.ok) throw new NetworkUnavailableError(cause);
    return undefined as T;
  }

  if (!response.ok) {
    throw new ApiError(response.status, payload as ErrorEnvelope);
  }

  return (payload as Envelope<T>).data;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

/** True when the error means "backend unreachable" rather than "backend said no". */
export function isBackendUnreachable(error: unknown): boolean {
  return error instanceof NetworkUnavailableError;
}

/** True when the backend responded but says the resource doesn't exist (e.g. no active list yet). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === "NOT_FOUND_OR_NOT_VISIBLE";
}