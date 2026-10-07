import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createContextAwarePool, setDbRequestContextFromHeaders } from "@gestione-dispensa/runtime-db/postgres-client.js";
import { createHash, randomUUID } from "node:crypto";
import {
  RegistrationError,
  parseRegisterUserInput,
  registerUser,
  requestPasswordReset,
  resolveKeycloakAdminConfig,
} from "./identity/register.js";

/**
 * service-identity: profilo utente + registrazione/reset password (Keycloak Admin API).
 *
 * Raggiungibile SOLO tramite nginx -> gateway. Il gateway verifica il JWT e inoltra l'identità
 * come header interni (x-user-id, x-oidc-sub, x-user-email, x-user-name, x-user-username).
 * Le rotte pubbliche (registrazione, reset password, logout, meta) non hanno un utente autenticato.
 */
const port = Number(process.env.PORT ?? 3310);
const service = "service-identity";
const pool = createContextAwarePool({ connectionString: process.env.DATABASE_URL });
const keycloak = resolveKeycloakAdminConfig();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BadRequest extends Error {}

function send(res: ServerResponse, status: number, payload: unknown, requestId: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("x-request-id", requestId);
  res.end(JSON.stringify(payload));
}

function fail(res: ServerResponse, status: number, code: string, message: string, requestId: string): void {
  send(res, status, {
    error: {
      code,
      message,
      details: [],
      retryable: status >= 502 || code === "CONFLICT",
      requestId,
    },
    meta: { requestId, traceId: requestId, schemaVersion: "1.0" },
  }, requestId);
}

async function beginIdempotency(id: string, key: string, body: unknown) {
  const requestHash = cryptoHash(body);
  const existing = await pool.query(
    "select actor_user_id,request_hash,status,response_status,response_body from idempotency_keys where key=$1 for update",
    [key],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (String(row.actor_user_id) !== id || row.request_hash !== requestHash) return { conflict: true as const };
    if (row.status === "completed" && row.response_status !== null) {
      return { replay: true as const, status: Number(row.response_status), body: row.response_body };
    }
    return { processing: true as const };
  }
  await pool.query(
    "insert into idempotency_keys(key,actor_user_id,request_hash,status,created_at,expires_at) values($1,$2,$3,'processing',now(),now()+interval '24 hours')",
    [key, id, requestHash],
  );
  return { new: true as const };
}

async function completeIdempotency(key: string, status: number, body: unknown): Promise<void> {
  await pool.query(
    "update idempotency_keys set status='completed',response_status=$2,response_body=$3 where key=$1",
    [key, status, JSON.stringify(body)],
  );
}

function cryptoHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* falls through */
  }
  throw new BadRequest("Il corpo della richiesta non è un JSON valido.");
}

/** Gli header dal gateway sono percent-encoded per sopravvivere a nomi con accenti. */
function decodedHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return undefined;
  try {
    return decodeURIComponent(first);
  } catch {
    return first;
  }
}

interface UserRow {
  id: string;
  subject: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  locale: string;
  timezone: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Crea (o aggiorna) il profilo locale a partire dall'identità verificata dal gateway. */
async function ensureUser(req: IncomingMessage, id: string): Promise<UserRow> {
  const subject = String(req.headers["x-oidc-sub"] ?? id);
  const email = decodedHeader(req, "x-user-email")?.toLowerCase() ?? null;
  const name = decodedHeader(req, "x-user-name") ?? null;
  const result = await pool.query<UserRow>(
    `insert into users(id, subject, email, display_name) values($1, $2, $3, $4)
     on conflict(id) do update set
       subject = excluded.subject,
       email = coalesce(users.email, excluded.email),
       display_name = coalesce(users.display_name, excluded.display_name),
       updated_at = now()
     returning *`,
    [id, subject, email, name],
  );
  return result.rows[0]!;
}

/** Canonical public Identity DTO from docs/API.md. */
function toUserDto(_req: IncomingMessage, u: UserRow) {
  return {
    userId: u.id,
    subject: u.subject,
    email: u.email,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    locale: u.locale,
    timezone: u.timezone,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

const PROFILE_PATHS = new Set(["/api/v1/identity/me"]);

const server = createServer(async (req, res) => {
  const requestId = String(req.headers["x-request-id"] ?? randomUUID());
  setDbRequestContextFromHeaders(req.headers);
  const method = req.method ?? "GET";
  const path = new URL(req.url ?? "/", "http://service-identity").pathname;

  try {
    // ── Salute ───────────────────────────────────────────────────────────────
    if (path === "/health/live") return send(res, 200, { status: "ok", service }, requestId);
    if (path === "/health/ready") {
      await pool.query("select 1");
      return send(res, 200, { status: "ready", service }, requestId);
    }

    // ── Rotte pubbliche (nessun JWT) ─────────────────────────────────────────
    if (method === "GET" && path === "/api/v1/meta") {
      return send(res, 200, { data: { service, version: process.env.APP_VERSION ?? "0.1.0-local" } }, requestId);
    }

    if (method === "POST" && path === "/api/v1/auth/register") {
      const input = parseRegisterUserInput(await readJson(req));
      if (!input) return fail(res, 400, "VALIDATION_ERROR", "Dati di registrazione non validi.", requestId);
      try {
        return send(res, 201, { data: await registerUser(input, keycloak) }, requestId);
      } catch (error) {
        if (error instanceof RegistrationError) {
          const status = { VALIDATION_ERROR: 400, USER_ALREADY_EXISTS: 409, AUTH_SERVICE_UNAVAILABLE: 503, REGISTRATION_FAILED: 502 }[error.code];
          return fail(res, status, error.code, error.message, requestId);
        }
        throw error;
      }
    }

    if (method === "POST" && path === "/api/v1/auth/reset-password") {
      const body = await readJson(req);
      await requestPasswordReset(typeof body.email === "string" ? body.email : "", keycloak);
      return send(res, 202, { data: { accepted: true, message: "Se l'email esiste, riceverai le istruzioni per reimpostare la password." } }, requestId);
    }

    if (method === "POST" && path === "/api/v1/auth/logout") {
      // Nessuna sessione server da invalidare: il client scarta i propri token.
      res.statusCode = 204;
      res.setHeader("x-request-id", requestId);
      return void res.end();
    }

    // ── Rotte autenticate (identità verificata dal gateway) ──────────────────
    const id = String(req.headers["x-user-id"] ?? "");
    if (!id || !UUID.test(id)) {
      return fail(res, 401, "UNAUTHENTICATED", "Missing authenticated user context.", requestId);
    }

    if (PROFILE_PATHS.has(path)) {
      const user = await ensureUser(req, id);

      if (method === "GET") return send(res, 200, { data: toUserDto(req, user) }, requestId);

      if (method === "PATCH") {
        const key = String(req.headers["x-idempotency-key"] ?? "").trim();
        const ifMatch = String(req.headers["if-match"] ?? "").trim();
        const b = await readJson(req);
        const allowed = ["displayName", "avatarUrl", "locale", "timezone"];
        const keys = Object.keys(b);
        if (!key || key.length < 8 || keys.length === 0 || keys.some((name) => !allowed.includes(name))) {
          return fail(res, 400, "VALIDATION_ERROR", "At least one documented profile field and X-Idempotency-Key are required.", requestId);
        }

        const current = await pool.query<UserRow>("select * from users where id=$1", [id]);
        if (!current.rowCount) return fail(res, 404, "NOT_FOUND", "User profile not found.", requestId);
        if (ifMatch) {
          const normalized = ifMatch.replace(/^W\//i, "").replace(/^"|"$/g, "").replace(/^version-/i, "");
          if (!/^\d+$/.test(normalized) || Number(normalized) !== Number(current.rows[0].version)) {
            return fail(res, 412, "PRECONDITION_FAILED", "Profile version changed.", requestId);
          }
        }

        const idem = await beginIdempotency(id, key, b);
        if (idem.conflict) return fail(res, 409, "CONFLICT", "Idempotency key conflict.", requestId);
        if (idem.replay) return send(res, idem.status, idem.body, requestId);
        if (idem.processing) return fail(res, 409, "CONFLICT", "The same operation is already processing.", requestId);

        const displayName = Object.hasOwn(b, "displayName") ? b.displayName : undefined;
        const r = await pool.query<UserRow>(
          `update users set
             display_name = case when $2 then $3 else display_name end,
             avatar_url   = case when $4 then $5 else avatar_url end,
             locale       = case when $6 then $7 else locale end,
             timezone     = case when $8 then $9 else timezone end,
             updated_at = now(), version = version + 1
           where id = $1 returning *`,
          [
            id,
            Object.hasOwn(b, "displayName"), displayName ?? null,
            Object.hasOwn(b, "avatarUrl"), b.avatarUrl ?? null,
            Object.hasOwn(b, "locale"), b.locale ?? null,
            Object.hasOwn(b, "timezone"), b.timezone ?? null,
          ],
        );
        const response = { data: toUserDto(req, r.rows[0]!), version: r.rows[0]!.version };
        await completeIdempotency(key, 200, response);
        return send(res, 200, response, requestId);
      }

      return fail(res, 405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed.", requestId);
    }

    return fail(res, 404, "NOT_FOUND", "Route not found.", requestId);
  } catch (error) {
    if (error instanceof BadRequest) return fail(res, 400, "VALIDATION_ERROR", error.message, requestId);
    console.error(JSON.stringify({ service, requestId, error: String(error) }));
    return fail(res, 500, "INTERNAL_ERROR", "Unexpected internal error.", requestId);
  }
});

server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ service, port })));
