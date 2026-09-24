import {
  API_BASE_URL,
  API_TIMEOUT_MS,
  DEV_BEARER_TOKEN,
  KEYCLOAK_REALM_URL,
  KEYCLOAK_CLIENT_ID,
} from "./config.js";
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

// ── Lettura/scrittura del bundle auth persistito ──────────────────────────────
//
// Il middleware `persist` di Zustand salva sotto `dispensa-auth` uno shape del tipo
// `{ state: { token, refreshToken, expiresAt, user, isAuthenticated }, version: 0 }`.
// Teniamo la lettura/scrittura qui, invece di importare `useAuthStore`, per evitare il ciclo
// di import `client.ts → store/auth.ts → api/endpoints.ts → client.ts` che in fase di
// bundling ESM può causare "Cannot access 'useAuthStore' before initialization".

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
    // FIX: Crea un nuovo oggetto se raw è null
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    if (!parsed.state) parsed.state = {};
    Object.assign(parsed.state, patch);
    localStorage.setItem("dispensa-auth", JSON.stringify(parsed));
  } catch (e) {
    console.error("Errore durante il salvataggio del token:", e);
  }
}

/** Nome del CustomEvent emesso quando una risposta 401 forza la fine della sessione. */
export const SESSION_EXPIRED_EVENT = "dispensa:session-expired";

/** Nome del CustomEvent emesso dopo un refresh riuscito, per allineare lo store Zustand in memoria. */
export const TOKENS_REFRESHED_EVENT = "dispensa:tokens-refreshed";

/**
 * Rimuove lo storage di auth (usato su 401 irrecuperabile) e notifica il resto dell'app con
 * un evento DOM, così lo store Zustand in memoria si allinea a quello che è appena stato
 * cancellato da localStorage. Senza questo evento l'app resterebbe convinta in memoria di
 * essere ancora autenticata mentre ogni richiesta successiva partirebbe senza token.
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

// ── Refresh trasparente con single-flight ─────────────────────────────────────
//
// `refreshPromise` è condivisa tra tutte le chiamate concorrenti: mentre un refresh è in
// corso, chiunque chiami ensureFreshAccessToken() aspetta la STESSA promise invece di far
// partire una nuova POST al token endpoint. Senza questo, un burst di richieste all'avvio
// (useInventory + useShoppingList + useFamily + useNotifications + getCurrentUser +
// listFamilies, tutte insieme) genererebbe decine di refresh simultanei: il primo consuma il
// refresh token, gli altri usano un token già invalidato e falliscono → logout spurio. Il
// sintomo lato browser è `ERR_INSUFFICIENT_RESOURCES` (limite ~6 connessioni per host).

let refreshPromise: Promise<string | null> | null = null;

/**
 * Rinnova l'access token se sta per scadere. Ritorna un access token valido (nuovo o
 * invariato), oppure null se non c'è modo di ottenerne uno.
 *
 * La soglia è 60 secondi: se aspettassimo la scadenza esatta, la richiesta in corso
 * partirebbe con un token già invalido. Rinnovando in anticipo, la latenza della POST al
 * token endpoint non blocca la richiesta originale.
 */
async function ensureFreshAccessToken(): Promise<string | null> {
  const auth = readPersistedAuth();
  if (!auth?.token) return null;

  // Senza refresh token o expiresAt non possiamo rinnovare: usiamo quello che c'è.
  if (!auth.refreshToken || !auth.expiresAt) return auth.token;

  // Token ancora valido: nessun refresh necessario.
  if (Date.now() < auth.expiresAt - 60_000) return auth.token;

  // Un refresh è già in corso: aspettiamo quello invece di farne partire un altro.
  if (refreshPromise !== null) return refreshPromise;

  refreshPromise = doRefresh(auth.refreshToken).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function doRefresh(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${KEYCLOAK_REALM_URL}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: KEYCLOAK_CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      // Refresh token scaduto o revocato: la sessione è davvero finita.
      clearPersistedAuth();
      return null;
    }

    const json = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const expiresAt = Date.now() + json.expires_in * 1000;

    writePersistedAuth({
      token: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt,
    });

    // Notifica lo store Zustand in memoria, così `useAuthStore((s) => s.token)` resta fresco
    // senza bisogno che client.ts importi lo store (che causerebbe un ciclo di import).
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(TOKENS_REFRESHED_EVENT, {
          detail: {
            accessToken: json.access_token,
            refreshToken: json.refresh_token,
            expiresAt,
          },
        }),
      );
    }

    return json.access_token;
  } catch {
    // Errore di rete durante il refresh: non buttare fuori l'utente. Usiamo il token
    // esistente (probabilmente scaduto): la prossima richiesta prenderà un 401 e il flusso
    // di logout partirà da lì, come deve essere.
    return readPersistedAuth()?.token ?? null;
  }
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const rawUrl = API_BASE_URL + path;
  // Relative API bases are intentional in local HTTPS mode: the browser must send the
  // request to the same origin (nginx :8443), not directly to the host API port.
  const url = /^https?:\/\//i.test(rawUrl)
    ? new URL(rawUrl)
    : new URL(rawUrl, window.location.origin);
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

  const token = (await ensureFreshAccessToken()) ?? DEV_BEARER_TOKEN;
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
    // L'access token era scaduto e il refresh in ensureFreshAccessToken potrebbe non averlo
    // rinnovato (es. nessun refresh token salvato). Non cancelliamo lo storage qui a mano:
    // lo fa doRefresh() quando il refresh fallisce. Qui ci limitiamo a segnalare l'evento,
    // così la UI può tornare al login senza loop di richieste.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
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