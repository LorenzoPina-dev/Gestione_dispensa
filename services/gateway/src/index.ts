import express, { type Request, type Response } from "express";
import { Readable } from "node:stream";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { annotate, currentContext, errorMiddleware, log, metrics, metricsHandler, noteUpstreamError, rebindContext, recordError, requestObservability, startObservability } from "./observability.js";

// Must run before anything else: installs structured logging, outbound fetch tracing and crash handlers.
startObservability("gateway");

const app = express();
const port = Number(process.env.PORT ?? 3300);
const identityBaseUrl = (process.env.IDENTITY_SERVICE_BASE_URL ?? "http://service-identity:3310/api/v1").replace(/\/$/, "");
const familyBaseUrl = (process.env.FAMILY_SERVICE_BASE_URL ?? "http://service-family:3311/api/v1").replace(/\/$/, "");
const inventoryBaseUrl = (process.env.INVENTORY_SERVICE_BASE_URL ?? "http://service-inventory:3312/api/v1").replace(/\/$/, "");
const shoppingBaseUrl = (process.env.SHOPPING_SERVICE_BASE_URL ?? "http://service-shopping:3313/api/v1").replace(/\/$/, "");
const catalogBaseUrl = (process.env.CATALOG_SERVICE_BASE_URL ?? "http://service-catalog:3314/api/v1").replace(/\/$/, "");
const notificationsBaseUrl = (process.env.NOTIFICATIONS_SERVICE_BASE_URL ?? "http://service-notifications:3315/api/v1").replace(/\/$/, "");
const privacyBaseUrl = (process.env.PRIVACY_SERVICE_BASE_URL ?? "http://service-privacy:3316/api/v1").replace(/\/$/, "");
const jobsBaseUrl = (process.env.JOBS_SERVICE_BASE_URL ?? "http://service-jobs:3317/api/v1").replace(/\/$/, "");
const requestTimeoutMs = Number(process.env.GATEWAY_TIMEOUT_MS ?? 5000);
const recipesBaseUrl = (process.env.RECIPES_SERVICE_BASE_URL ?? "http://service-recipes:3401/api/v1").replace(/\/$/, "");
const nutritionBaseUrl = (process.env.NUTRITION_SERVICE_BASE_URL ?? "http://service-nutrition:3402/api/v1").replace(/\/$/, "");
const storesBaseUrl = (process.env.STORES_SERVICE_BASE_URL ?? "http://service-stores:3403/api/v1").replace(/\/$/, "");
const oidcIssuer = process.env.OIDC_ISSUER ?? "";
const oidcAudience = process.env.OIDC_AUDIENCE ?? "";
const oidcJwksUrl = process.env.OIDC_JWKS_URL ?? "http://keycloak:8080/realms/dispensa/protocol/openid-connect/certs";
const jwks = createRemoteJWKSet(new URL(oidcJwksUrl));

app.disable("x-powered-by");
// First middleware: assigns requestId/traceId (or continues the ones sent by nginx/browser) and writes one access-log line per request.
app.use(requestObservability());
app.use(express.json({ limit: "2mb", type: (req) => !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("multipart/form-data") }));
app.use(rebindContext());

// Header d'identità interni: li imposta SOLO il gateway dopo aver verificato il JWT. Qualunque valore
// inviato dal browser (anche su rotte pubbliche) viene scartato per impedire lo spoofing dell'utente.
const INTERNAL_IDENTITY_HEADERS = ["x-user-id", "x-oidc-sub", "x-user-email", "x-user-name", "x-user-username"] as const;
app.use((req, _res, next) => {
  for (const name of INTERNAL_IDENTITY_HEADERS) delete req.headers[name];
  next();
});

const clientErrors = metrics.counter("web_client_errors_total", "Errors reported by the browser app.", ["kind"]);
const CLIENT_ERROR_KINDS = new Set(["js_error", "unhandled_rejection", "react_render", "api_error", "network_error"]);
const beaconHits = new Map<string, { count: number; resetAt: number }>();
const short = (value: unknown, max: number): string | undefined => (typeof value === "string" && value ? value.slice(0, max) : undefined);

/**
 * Browser error beacon. Public on purpose (a broken login must still be reportable), so it is
 * size-limited and capped per IP. The browser sends the requestId/traceId of the failing call,
 * which lets you jump from a UI error straight to the backend trace (Grafana > Tempo / Loki).
 */
app.post("/api/v1/client-errors", (req, res) => {
  const ip = req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const hit = beaconHits.get(ip);
  if (!hit || hit.resetAt < now) beaconHits.set(ip, { count: 1, resetAt: now + 60_000 });
  else if (++hit.count > 30) { res.status(429).end(); return; }
  if (beaconHits.size > 5000) beaconHits.clear();
  const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const kind = CLIENT_ERROR_KINDS.has(String(body.kind)) ? String(body.kind) : "other";
  clientErrors.inc({ kind });
  log.warn("web.client_error", {
    kind,
    message: short(body.message, 500),
    stack: short(body.stack, 3000),
    page: short(body.page, 200),
    apiPath: short(body.apiPath, 200),
    apiStatus: typeof body.status === "number" ? body.status : undefined,
    apiCode: short(body.code, 64),
    webRequestId: short(body.requestId, 128),
    webTraceId: short(body.traceId, 32),
    appVersion: short(body.appVersion, 32),
    userAgent: short(req.header("user-agent"), 200),
  });
  res.status(204).end();
});

app.get("/health/live", (_req, res) => res.status(200).json({ status: "ok" }));
app.get("/metrics", metricsHandler);
app.use("/api/v1/views", requireGatewayAuth);
// Rotte pubbliche: chi si registra o recupera la password non ha ancora un token.
// Devono stare PRIMA del ciclo sottostante, che impone requireGatewayAuth su /api/v1/auth.
app.post("/api/v1/auth/register", serviceProxy(identityBaseUrl));
app.post("/api/v1/auth/reset-password", serviceProxy(identityBaseUrl));
app.post("/api/v1/auth/logout", requireGatewayAuth, serviceProxy(identityBaseUrl));
app.get("/api/v1/meta", serviceProxy(identityBaseUrl));
app.get("/api/v1/family-invites/:token", serviceProxy(familyBaseUrl));
for (const [prefix, base] of [
  ["/api/v1/identity", identityBaseUrl], ["/api/v1/meta", identityBaseUrl],
  ["/api/v1/families", familyBaseUrl], ["/api/v1/family-invites", familyBaseUrl], ["/api/v1/invites", familyBaseUrl],
  ["/api/v1/inventory", inventoryBaseUrl], ["/api/v1/shopping", shoppingBaseUrl],
  ["/api/v1/catalog", catalogBaseUrl],
  ["/api/v1/notifications", notificationsBaseUrl], ["/api/v1/privacy", privacyBaseUrl], ["/api/v1/jobs", jobsBaseUrl],
] as const) app.use(prefix, requireGatewayAuth, serviceProxy(base));
app.post("/api/v1/recipes/:recipeId/add-missing", requireGatewayAuth, async (req, res) => {
  const familyId = typeof req.body?.familyId === "string"
    ? req.body.familyId.trim()
    : typeof req.query.familyId === "string"
      ? req.query.familyId.trim()
      : "";
  const authorization = req.header("authorization") ?? undefined;
  if (!familyId) {
    res.status(400).json(withMeta({ error: { code: "VALIDATION_ERROR", message: "familyId is required.", retryable: false } }));
    return;
  }

  try {
    const [recipe, pantry, shopping] = await Promise.all([
      serviceGet(recipesBaseUrl, `/recipes/${encodeURIComponent(req.params.recipeId)}`, authorization, { familyId }),
      coreGet("/inventory", authorization, { familyId }),
      getActiveShopping(familyId, authorization),
    ]);

    if (!shopping?.list?.listId) {
      throw new GatewayError(409, { error: { code: "CONFLICT", message: "No active shopping list exists.", retryable: false } }, "service-shopping");
    }

    const pantryItems = Array.isArray(pantry.items) ? pantry.items : [];
    const recipeIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const activeItems = Array.isArray(shopping.items) ? shopping.items : [];

    const missing = recipeIngredients.filter((ingredient: any) => {
      const needed = Number(ingredient.quantity ?? 0);
      const productId = ingredient.productId ? String(ingredient.productId) : null;
      const available = pantryItems
        .filter((item: any) => productId ? String(item.productId) === productId : String(item.name ?? "").toLowerCase() === String(ingredient.name ?? "").toLowerCase())
        .reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0);
      return available < needed;
    });

    const createdIds: string[] = [];
    for (const [index, ingredient] of missing.entries()) {
      const label = String(ingredient.name ?? ingredient.displayName ?? "").trim();
      if (!label) continue;
      const productId = ingredient.productId ? String(ingredient.productId) : undefined;
      const alreadyQueued = activeItems.some((item: any) =>
        productId
          ? String(item.productId ?? "") === productId && item.checked !== true
          : String(item.label ?? "").toLowerCase() === label.toLowerCase() && item.checked !== true,
      );
      if (alreadyQueued) continue;

      const mutationKey = `recipe-missing:${req.params.recipeId}:${productId ?? label.toLowerCase()}:${index}`;
      const url = new URL(`${shoppingBaseUrl}/shopping/lists/${encodeURIComponent(String(shopping.list.listId))}/items`);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-user-id": String(req.headers["x-user-id"] ?? ""),
        "x-family-id": familyId,
        "x-idempotency-key": mutationKey,
        ...(authorization ? { Authorization: authorization } : {}),
      };
      const upstream = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          familyId,
          productId: productId ?? null,
          label,
          quantity: Math.max(0.001, Number(ingredient.quantity ?? 1)),
          unit: String(ingredient.unit ?? "piece"),
          source: "recipe",
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const body = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        throw new GatewayError(upstream.status, body, `${url.host}${url.pathname}`);
      }
      const data = body?.data ?? body;
      if (data?.itemId) createdIds.push(String(data.itemId));
    }

    res.status(200).json(withMeta({ data: { itemIds: createdIds }, version: 1 }));
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 502;
    const body = error instanceof GatewayError ? error.body : { error: { code: "UPSTREAM_UNAVAILABLE", message: "Unable to add recipe ingredients to shopping list.", retryable: true } };
    recordError(error, { status });
    res.status(status).json(withMeta(body));
  }
});

app.use("/api/v1/recipes", requireGatewayAuth, serviceProxy(recipesBaseUrl));
app.use("/api/v1/nutrition", requireGatewayAuth, serviceProxy(nutritionBaseUrl));
app.use("/api/v1/stores", requireGatewayAuth, serviceProxy(storesBaseUrl));
app.use("/api/v1/shelf-life", requireGatewayAuth, serviceProxy(`${process.env.SHELF_LIFE_SERVICE_BASE_URL ?? "http://service-shelf-life:3404/api/v1"}`));
app.use("/api/v1/ocr", requireGatewayAuth, serviceProxy(`${process.env.OCR_SERVICE_BASE_URL ?? "http://service-ocr:3405/api/v1"}`));


app.get("/health/ready", async (_req, res) => {
  try {
    const response = await fetch(`${identityBaseUrl.replace(/\/api\/v1$/, "")}/health/ready`, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    res.status(response.status).json(body);
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

/**
 * Composite screen endpoints. The browser makes exactly one request per active screen;
 * the gateway fans out to the owning API domains in parallel and returns one view model.
 * Domain services can later move behind these calls without changing the Web contract.
 */
app.get("/api/v1/dashboard", requireGatewayAuth, (req, res) => composite(req, res, dashboardView));
app.get("/api/v1/views/dashboard-today", (req, res) => composite(req, res, dashboardView));
app.get("/api/v1/views/pantry-screen", (req, res) => composite(req, res, pantryView));
app.get("/api/v1/views/shopping-screen", (req, res) => composite(req, res, shoppingView));
app.get("/api/v1/views/recipes-screen", (req, res) => composite(req, res, recipesView));
app.get("/api/v1/views/nutrition-screen", (req, res) => composite(req, res, nutritionView));
app.get("/api/v1/views/family-screen", (req, res) => composite(req, res, familyView));
app.get("/api/v1/views/notifications-screen", (req, res) => composite(req, res, notificationsView));

async function requireGatewayAuth(req: Request, res: Response, next: express.NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return res.status(401).json(withMeta({ error: { code: "UNAUTHENTICATED", message: "Authentication is required.", retryable: false } }));
  if (!oidcIssuer || !oidcAudience) return res.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Gateway identity verification is not configured.", retryable: true } });
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks, { issuer: oidcIssuer, audience: oidcAudience });
    if (payload.sub) {
      annotate({ userId: payload.sub });
      // Domain services receive the verified subject as internal request context.
      // The browser cannot authoritatively set this value.
      req.headers["x-user-id"] = String(payload.sub);
      req.headers["x-oidc-sub"] = String(payload.sub);
      // Claim del profilo, percent-encoded perché gli header HTTP non ammettono caratteri non ASCII.
      if (typeof payload.email === "string") req.headers["x-user-email"] = encodeURIComponent(payload.email);
      if (typeof payload.name === "string") req.headers["x-user-name"] = encodeURIComponent(payload.name);
      if (typeof payload.preferred_username === "string") req.headers["x-user-username"] = encodeURIComponent(payload.preferred_username);
    }
  } catch (error) {
    // The reason (expired, bad signature, wrong issuer/audience, JWKS unreachable) tells a client bug from a config bug.
    recordError(error, { status: 401 });
    res.status(401).json(withMeta({ error: { code: "UNAUTHENTICATED", message: "Invalid access token.", retryable: false } }));
    return;
  }
  next();
}

function serviceProxy(baseUrl: string): express.RequestHandler {
  return async (req, res) => {
    const base = baseUrl.replace(/\/$/, "");
    const suffix = req.originalUrl.replace(/^\/api\/v1/, "");
    const url = new URL(base + suffix);
    for (const [key, value] of Object.entries(req.query)) { if (typeof value === "string") url.searchParams.set(key, value); }
    const headers: Record<string,string> = { Accept: "application/json" };
    const authorization = req.header("authorization"); if (authorization) headers.Authorization = authorization;
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const incomingContentType = req.header("content-type") ?? "";
    const isMultipart = incomingContentType.toLowerCase().startsWith("multipart/form-data");
    if (hasBody && !isMultipart) headers["Content-Type"] = "application/json";
    if (isMultipart) headers["Content-Type"] = incomingContentType;
    // Headers the domain services depend on: RLS family context, idempotency and optimistic locking.
    // traceparent / x-request-id are added automatically by the instrumented fetch.
    for (const name of ["x-user-id", "x-oidc-sub", "x-user-email", "x-user-name", "x-user-username", "x-correlation-id", "idempotency-key", "x-idempotency-key", "if-match"]) { const value = req.header(name); if (value) headers[name] = value; }
    // Family context is never accepted from a forged x-family-id header. Derive it from the
    // validated request shape (query/body/path) and let the owning service authorize membership.
    const familyId = extractFamilyId(req);
    if (familyId) headers["x-family-id"] = familyId;
    const target = `${url.host}${url.pathname}`;
    annotate({ upstream: target });
    try {
      const init: RequestInit & { duplex?: "half" } = {
        method: req.method,
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
      };
      if (hasBody) {
        if (isMultipart) {
          init.body = Readable.toWeb(req) as unknown as BodyInit;
          init.duplex = "half";
        } else {
          init.body = JSON.stringify(req.body ?? {});
        }
      }
      const upstream = await fetch(url, init);
      const text = await upstream.text();
      if (upstream.status >= 400) {
        // Copy the upstream error code/message into this hop's access-log line: one log line tells who failed and why.
        try { noteUpstreamFailure(JSON.parse(text), target); } catch { noteUpstreamFailure(undefined, target); }
      }
      res.status(upstream.status);
      const contentType = upstream.headers.get("content-type");
      if (upstream.status >= 400) {
        let body: unknown = undefined;
        try { body = JSON.parse(text); } catch { body = undefined; }
        const normalized = normalizeGatewayError(body, upstream.status);
        res.json(normalized);
        return;
      }
      if (contentType) res.setHeader("content-type", contentType);
      res.send(text);
    } catch (error) {
      recordError(error, { status: 502 });
      noteUpstreamError("UPSTREAM_UNAVAILABLE", error instanceof Error ? error.message : "Service unavailable");
      res.status(502).json(withMeta({ error:{ code:"UPSTREAM_UNAVAILABLE", message:error instanceof Error?error.message:"Service unavailable", retryable:true } }));
    }
  };
}

async function composite(
  req: Request,
  res: Response,
  builder: (familyId: string, authorization?: string) => Promise<Record<string, unknown>>,
): Promise<void> {
  const familyId = typeof req.query.familyId === "string" ? req.query.familyId.trim() : "";
  if (!familyId) {
    res.status(400).json(withMeta({ error: { code: "VALIDATION_ERROR", message: "familyId is required", retryable: false } }));
    return;
  }
  if (/^[A-Za-z0-9._:-]{8,128}$/.test(familyId)) annotate({ familyId }); // log correlation only; user input, so shape-checked
  try {
    const data = await builder(familyId, req.header("authorization") ?? undefined);
    res.status(200).json({ data, meta: { schemaVersion: "view.v1" } });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 502;
    const body = error instanceof GatewayError ? error.body : undefined;
    recordError(error, { status });
    if (error instanceof GatewayError) noteUpstreamFailure(error.body, error.target);
    res.status(status).json(withMeta(body ?? { error: { code: "UPSTREAM_UNAVAILABLE", message: "Core API unavailable", retryable: true } }));
  }
}

async function getActiveShopping(familyId: string, authorization?: string): Promise<Record<string, any> | undefined> {
  const lists = await serviceGet(shoppingBaseUrl, "/shopping/lists", authorization, { familyId });
  const active = Array.isArray(lists.items) ? lists.items.find((item: any) => item.status === "open") : undefined;
  if (!active) return undefined;
  const detail = await serviceGet(shoppingBaseUrl, `/shopping/lists/${encodeURIComponent(String(active.listId))}`, authorization, { familyId });
  return {
    list: {
      listId: String(detail.listId),
      name: String(detail.name),
      status: detail.status,
      itemCount: Array.isArray(detail.items) ? detail.items.length : 0,
      version: Number(detail.version ?? active.version ?? 1),
    },
    items: Array.isArray(detail.items) ? detail.items : [],
  };
}

async function dashboardView(familyId: string, authorization?: string) {
  const [family, members, pantry, shopping, recipes, notifications, ocr] = await Promise.all([
    coreGet(`/families/${encodeURIComponent(familyId)}`, authorization),
    coreGet(`/families/${encodeURIComponent(familyId)}/members`, authorization),
    coreGet("/inventory", authorization, { familyId }),
    getActiveShopping(familyId, authorization),
    serviceGet(recipesBaseUrl, "/recipes/suggestions", authorization, { familyId }),
    coreGet("/notifications", authorization, { familyId }),
    serviceGet(`${process.env.OCR_SERVICE_BASE_URL ?? "http://service-ocr:3405/api/v1"}`, "/ocr/jobs", authorization, { familyId, status: "needs_review" }),
  ]);
  return composeCommon(familyId, family, members, pantry, shopping, notifications, {
    suggestedRecipes: recipes.items ?? [],
    pendingOcrReviews: ocr.items ?? [],
  });
}

async function pantryView(familyId: string, authorization?: string) {
  const [pantry, shopping, notifications] = await Promise.all([
    coreGet("/inventory", authorization, { familyId }),
    getActiveShopping(familyId, authorization),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return composeCommon(familyId, undefined, undefined, pantry, shopping, notifications);
}

async function shoppingView(familyId: string, authorization?: string) {
  const [shopping, pantry, notifications] = await Promise.all([
    getActiveShopping(familyId, authorization),
    coreGet("/inventory", authorization, { familyId }),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return composeCommon(familyId, undefined, undefined, pantry, shopping, notifications);
}

async function recipesView(familyId: string, authorization?: string) {
  const [recipes, pantry, shopping, notifications] = await Promise.all([
    serviceGet(recipesBaseUrl, "/recipes/suggestions", authorization, { familyId }),
    coreGet("/inventory", authorization, { familyId }),
    getActiveShopping(familyId, authorization),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return composeCommon(familyId, undefined, undefined, pantry, shopping, notifications, {
    suggestedRecipes: recipes.items ?? [],
  });
}

async function nutritionView(familyId: string, authorization?: string) {
  const [nutrition, pantry, notifications] = await Promise.all([
    serviceGet(nutritionBaseUrl, "/nutrition/summary", authorization, { familyId, period: "today" }),
    coreGet("/inventory", authorization, { familyId }),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return composeCommon(familyId, undefined, undefined, pantry, undefined, notifications, { nutrition });
}

async function familyView(familyId: string, authorization?: string) {
  const [family, members, invites, notifications] = await Promise.all([
    coreGet(`/families/${encodeURIComponent(familyId)}`, authorization),
    coreGet(`/families/${encodeURIComponent(familyId)}/members`, authorization),
    coreGet(`/families/${encodeURIComponent(familyId)}/invites`, authorization),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return {
    familyId,
    family: family.family ?? family,
    members: members.items ?? [],
    invites: invites.items ?? [],
    navigationSummary: navigationSummary(undefined, undefined, notifications),
  };
}

async function notificationsView(familyId: string, authorization?: string) {
  const [notifications, pantry] = await Promise.all([
    coreGet("/notifications", authorization, { familyId }),
    coreGet("/inventory", authorization, { familyId }),
  ]);
  return {
    familyId,
    notifications: notifications.items ?? [],
    navigationSummary: navigationSummary(pantry, undefined, notifications),
  };
}

function composeCommon(
  familyId: string,
  family: Record<string, any> | undefined,
  members: Record<string, any> | undefined,
  pantry: Record<string, any> | undefined,
  shopping: Record<string, any> | undefined,
  notifications: Record<string, any> | undefined,
  extra: Record<string, unknown> = {},
) {
  return {
    familyId,
    family: family?.family ?? family,
    members: members?.items ?? [],
    pantry: pantry?.items ?? [],
    shopping: shopping ?? null,
    notifications: notifications?.items ?? [],
    ...extra,
    navigationSummary: navigationSummary(pantry, shopping, notifications),
  };
}

function navigationSummary(
  pantry: Record<string, any> | undefined,
  shopping: Record<string, any> | undefined,
  notifications: Record<string, any> | undefined,
) {
  const items = Array.isArray(pantry?.items) ? pantry.items : [];
  let expired = 0;
  let expiringSoon = 0;
  for (const item of items) {
    const dates = Array.isArray(item.batches)
      ? item.batches.map((b: any) => b?.expiryDate).filter(Boolean).map((d: string) => new Date(d).getTime())
      : [];
    if (!dates.length) continue;
    const days = Math.ceil((Math.min(...dates) - Date.now()) / 86_400_000);
    if (days <= 0) expired += 1;
    else if (days <= 5) expiringSoon += 1;
  }
  const unread = Array.isArray(notifications?.items)
    ? notifications.items.filter((n: any) => !n.readAt).length
    : 0;
  const pendingShopping = Array.isArray(shopping?.items)
    ? shopping.items.filter((i: any) => i.state === "ACCEPTED").length
    : 0;
  return { expiredCount: expired, expiringSoonCount: expiringSoon, unreadNotifications: unread, pendingShopping };
}

async function coreGet(path: string, authorization?: string, query?: Record<string, string>): Promise<Record<string, any>> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const table: Array<[string, string]> = [
    ["/families", familyBaseUrl], ["/family-invites", familyBaseUrl], ["/invites", familyBaseUrl],
    ["/inventory", inventoryBaseUrl], ["/shopping", shoppingBaseUrl],
    ["/products", catalogBaseUrl], ["/catalog", catalogBaseUrl], ["/notifications", notificationsBaseUrl],
    ["/privacy", privacyBaseUrl], ["/identity", identityBaseUrl], ["/meta", identityBaseUrl],
  ];
  const entry = table.find(([prefix]) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  const result = entry ? await callBase(entry[1], normalized, authorization, query) : await callBase(identityBaseUrl, normalized, authorization, query);
  if (!result.ok) throw new GatewayError(result.status, result.body, result.target);
  return (result.body?.data ?? result.body) as Record<string, any>;
}

async function serviceGet(baseUrl: string, path: string, authorization?: string, query?: Record<string, string>): Promise<Record<string, any>> {
  const result = await callBase(baseUrl, path, authorization, query);
  if (!result.ok) throw new GatewayError(result.status, result.body, result.target);
  return (result.body?.data ?? result.body) as Record<string, any>;
}

function extractFamilyId(req: Request): string | undefined {
  const queryFamilyId = typeof req.query.familyId === "string" ? req.query.familyId.trim() : "";
  const body = typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : undefined;
  const bodyFamilyId = typeof body?.familyId === "string" ? body.familyId.trim() : "";
  const familyPath = req.originalUrl.match(/\/api\/v1\/famil(?:y|ies)(?:-invites)?\/([0-9a-f-]{8,64})/i)?.[1] ?? "";
  const candidate = queryFamilyId || bodyFamilyId || familyPath;
  return candidate || undefined;
}

async function callBase(baseUrl: string, path: string, authorization?: string, query?: Record<string, string>) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const ctx = currentContext();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    };
    if (ctx?.userId) headers["x-user-id"] = ctx.userId;
    const familyId = query?.familyId ?? ctx?.familyId;
    if (familyId) headers["x-family-id"] = familyId;
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body, target: `${url.host}${url.pathname}` };
  } catch (error) {
    throw new GatewayError(502, {
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Core API unavailable",
        retryable: true,
      },
    }, `${url.host}${url.pathname}`, error);
  } finally {
    clearTimeout(timer);
  }
}

class GatewayError extends Error {
  public constructor(public readonly status: number, public readonly body: unknown, public readonly target = "unknown", cause?: unknown) {
    super(`Upstream ${target} answered ${status}`);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Names the failing service and copies its error code/message into this hop's access-log line. */
function noteUpstreamFailure(body: unknown, target?: string): void {
  if (target) annotate({ upstream: target });
  if (typeof body !== "object" || body === null) return;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") noteUpstreamError(error, (body as { message?: unknown }).message);
  else if (typeof error === "object" && error !== null) noteUpstreamError((error as { code?: unknown }).code, (error as { message?: unknown }).message);
}

/** Gateway-generated errors carry requestId/traceId so a user-visible failure can be quoted and found in Grafana. */
function normalizeGatewayError(body: unknown, status: number): Record<string, unknown> {
  const candidate = typeof body === "object" && body !== null ? body as Record<string, any> : {};
  const error = typeof candidate.error === "object" && candidate.error !== null ? candidate.error as Record<string, any> : {};
  const ctx = currentContext();
  return withMeta({
    error: {
      code: typeof error.code === "string" ? error.code : status >= 500 ? "UPSTREAM_ERROR" : "HTTP_ERROR",
      message: typeof error.message === "string" ? error.message : "The request could not be completed.",
      details: Array.isArray(error.details) ? error.details : [],
      retryable: typeof error.retryable === "boolean" ? error.retryable : status >= 500,
      requestId: typeof error.requestId === "string" ? error.requestId : ctx.requestId,
    },
  }) as Record<string, unknown>;
}
function withMeta(body: unknown): unknown {
  const ctx = currentContext();
  if (!ctx || typeof body !== "object" || body === null || "meta" in body) return body;
  return { ...body, meta: { requestId: ctx.requestId, traceId: ctx.traceId, schemaVersion: "1.0" } };
}

// Last middleware: turns thrown errors into the JSON envelope with requestId/traceId and records the cause.
app.use(errorMiddleware());

app.listen(port, "0.0.0.0", () => {
  log.info("service.listening", { port, identityBaseUrl, familyBaseUrl, inventoryBaseUrl, shoppingBaseUrl, catalogBaseUrl, notificationsBaseUrl });
});
