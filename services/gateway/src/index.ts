import express, { type Request, type Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

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
app.use(express.json({ limit: "2mb" }));

app.get("/health/live", (_req, res) => res.status(200).json({ status: "ok" }));
app.get("/metrics", (_req, res) => { res.type("text/plain").send(`# HELP process_uptime_seconds Gateway process uptime.\n# TYPE process_uptime_seconds gauge\nprocess_uptime_seconds ${process.uptime()}\n`); });
app.use("/api/v1/views", requireGatewayAuth);
for (const [prefix, base] of [
  ["/api/v1/auth", identityBaseUrl], ["/api/v1/me", identityBaseUrl], ["/api/v1/meta", identityBaseUrl],
  ["/api/v1/families", familyBaseUrl], ["/api/v1/family-invites", familyBaseUrl], ["/api/v1/invites", familyBaseUrl],
  ["/api/v1/inventory", inventoryBaseUrl], ["/api/v1/shopping-lists", shoppingBaseUrl], ["/api/v1/shopping", shoppingBaseUrl],
  ["/api/v1/products", catalogBaseUrl], ["/api/v1/catalog", catalogBaseUrl],
  ["/api/v1/notifications", notificationsBaseUrl], ["/api/v1/privacy", privacyBaseUrl], ["/api/v1/jobs", jobsBaseUrl],
] as const) app.use(prefix, requireGatewayAuth, serviceProxy(base));
app.use("/api/v1/recipes", requireGatewayAuth, serviceProxy(recipesBaseUrl));
app.use("/api/v1/nutrition", requireGatewayAuth, serviceProxy(nutritionBaseUrl));
app.use("/api/v1/stores", requireGatewayAuth, serviceProxy(storesBaseUrl));
app.use("/api/v1/shelf-life", requireGatewayAuth, serviceProxy(`${process.env.SHELF_LIFE_SERVICE_BASE_URL ?? "http://service-shelf-life:3404/api/v1"}`));
app.use("/api/v1/ocr-jobs", requireGatewayAuth, serviceProxy(`${process.env.OCR_SERVICE_BASE_URL ?? "http://service-ocr:3405/api/v1"}`));
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
app.get("/api/v1/views/dashboard-today", (req, res) => composite(req, res, dashboardView));
app.get("/api/v1/views/pantry-screen", (req, res) => composite(req, res, pantryView));
app.get("/api/v1/views/shopping-screen", (req, res) => composite(req, res, shoppingView));
app.get("/api/v1/views/recipes-screen", (req, res) => composite(req, res, recipesView));
app.get("/api/v1/views/nutrition-screen", (req, res) => composite(req, res, nutritionView));
app.get("/api/v1/views/family-screen", (req, res) => composite(req, res, familyView));
app.get("/api/v1/views/notifications-screen", (req, res) => composite(req, res, notificationsView));

async function requireGatewayAuth(req: Request, res: Response, next: express.NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required.", retryable: false } });
  if (!oidcIssuer || !oidcAudience) return res.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "Gateway identity verification is not configured.", retryable: true } });
  try { await jwtVerify(header.slice(7), jwks, { issuer: oidcIssuer, audience: oidcAudience }); next(); }
  catch { res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Invalid access token.", retryable: false } }); }
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
    if (hasBody) headers["Content-Type"] = "application/json";
    try {
      const upstream = await fetch(url, {
        method: req.method,
        headers,
        ...(hasBody ? { body: JSON.stringify(req.body ?? {}) } : {}),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const text = await upstream.text();
      res.status(upstream.status);
      const contentType = upstream.headers.get("content-type"); if (contentType) res.setHeader("content-type",contentType);
      res.send(text);
    } catch (error) {
      res.status(502).json({ error:{ code:"UPSTREAM_UNAVAILABLE", message:error instanceof Error?error.message:"Service unavailable", retryable:true } });
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
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "familyId is required", retryable: false } });
    return;
  }
  try {
    const data = await builder(familyId, req.header("authorization") ?? undefined);
    res.status(200).json({ data, meta: { schemaVersion: "view.v1" } });
  } catch (error) {
    const status = error instanceof GatewayError ? error.status : 502;
    const body = error instanceof GatewayError ? error.body : undefined;
    res.status(status).json(body ?? { error: { code: "UPSTREAM_UNAVAILABLE", message: "Core API unavailable", retryable: true } });
  }
}

async function dashboardView(familyId: string, authorization?: string) {
  const [family, members, pantry, shopping, recipes, notifications, ocr] = await Promise.all([
    coreGet(`/families/${encodeURIComponent(familyId)}`, authorization),
    coreGet(`/families/${encodeURIComponent(familyId)}/members`, authorization),
    coreGet("/inventory/stock-items", authorization, { familyId }),
    coreGet("/shopping-lists/active", authorization, { familyId }),
    serviceGet(recipesBaseUrl, "/recipes/suggestions", authorization, { familyId }),
    coreGet("/notifications", authorization, { familyId }),
    serviceGet(`${process.env.OCR_SERVICE_BASE_URL ?? "http://service-ocr:3405/api/v1"}`, "/ocr-jobs", authorization, { familyId, status: "NEEDS_REVIEW" }),
  ]);
  return composeCommon(familyId, family, members, pantry, shopping, notifications, {
    suggestedRecipes: recipes.suggestions ?? [],
    pendingOcrReviews: ocr.jobs ?? [],
  });
}

async function pantryView(familyId: string, authorization?: string) {
  const [pantry, shopping, notifications] = await Promise.all([
    coreGet("/inventory/stock-items", authorization, { familyId }),
    coreGet("/shopping-lists/active", authorization, { familyId }),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return composeCommon(familyId, undefined, undefined, pantry, shopping, notifications);
}

async function shoppingView(familyId: string, authorization?: string) {
  const [shopping, pantry, notifications] = await Promise.all([
    coreGet("/shopping-lists/active", authorization, { familyId }),
    coreGet("/inventory/stock-items", authorization, { familyId }),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return composeCommon(familyId, undefined, undefined, pantry, shopping, notifications);
}

async function recipesView(familyId: string, authorization?: string) {
  const [recipes, pantry, shopping, notifications] = await Promise.all([
    serviceGet(recipesBaseUrl, "/recipes/suggestions", authorization, { familyId }),
    coreGet("/inventory/stock-items", authorization, { familyId }),
    coreGet("/shopping-lists/active", authorization, { familyId }),
    coreGet("/notifications", authorization, { familyId }),
  ]);
  return composeCommon(familyId, undefined, undefined, pantry, shopping, notifications, {
    suggestedRecipes: recipes.suggestions ?? [],
  });
}

async function nutritionView(familyId: string, authorization?: string) {
  const [nutrition, pantry, notifications] = await Promise.all([
    serviceGet(nutritionBaseUrl, "/nutrition/summary", authorization, { familyId, period: "today" }),
    coreGet("/inventory/stock-items", authorization, { familyId }),
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
    members: members.memberships ?? [],
    invites: invites.invites ?? [],
    navigationSummary: navigationSummary(undefined, undefined, notifications),
  };
}

async function notificationsView(familyId: string, authorization?: string) {
  const [notifications, pantry] = await Promise.all([
    coreGet("/notifications", authorization, { familyId }),
    coreGet("/inventory/stock-items", authorization, { familyId }),
  ]);
  return {
    familyId,
    notifications: notifications.notifications ?? [],
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
    members: members?.memberships ?? [],
    pantry: pantry?.items ?? [],
    shopping: shopping ?? null,
    notifications: notifications?.notifications ?? [],
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
  const unread = Array.isArray(notifications?.notifications)
    ? notifications.notifications.filter((n: any) => !n.readAt).length
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
    ["/inventory", inventoryBaseUrl], ["/shopping-lists", shoppingBaseUrl], ["/shopping", shoppingBaseUrl],
    ["/products", catalogBaseUrl], ["/catalog", catalogBaseUrl], ["/notifications", notificationsBaseUrl],
    ["/privacy", privacyBaseUrl], ["/jobs", jobsBaseUrl], ["/auth", identityBaseUrl], ["/me", identityBaseUrl], ["/meta", identityBaseUrl],
  ];
  const entry = table.find(([prefix]) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  const result = entry ? await callBase(entry[1], normalized, authorization, query) : await callBase(identityBaseUrl, normalized, authorization, query);
  if (!result.ok) throw new GatewayError(result.status, result.body);
  return (result.body?.data ?? result.body) as Record<string, any>;
}

async function serviceGet(baseUrl: string, path: string, authorization?: string, query?: Record<string, string>): Promise<Record<string, any>> {
  const result = await callBase(baseUrl, path, authorization, query);
  if (!result.ok) throw new GatewayError(result.status, result.body);
  return (result.body?.data ?? result.body) as Record<string, any>;
}

async function callBase(baseUrl: string, path: string, authorization?: string, query?: Record<string, string>) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    throw new GatewayError(502, {
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Core API unavailable",
        retryable: true,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

class GatewayError extends Error {
  public constructor(public readonly status: number, public readonly body: unknown) {
    super("Gateway upstream error");
  }
}

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(JSON.stringify({ service: "gateway", port, identityBaseUrl, familyBaseUrl, inventoryBaseUrl, shoppingBaseUrl, catalogBaseUrl, notificationsBaseUrl }) + "\n");
});
