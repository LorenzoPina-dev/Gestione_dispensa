import express from "express";
import { PostgresClient, resolveDatabaseUrl } from "./db/postgres-client.js";
import { OidcTokenVerifier } from "./identity/oidc.js";
import { PostgresUserProfileRepository } from "./identity/users.js";
import { parseRegisterUserInput, registerUser, resolveKeycloakAdminConfig, requestPasswordReset, RegistrationError } from "./identity/register.js";
import { buildMeta, sendFailure, sendSuccess } from "./http/envelope.js";
import { corsMiddleware, requestMetaMiddleware, resolvePrincipal } from "./http/middleware.js";

const port = Number(process.env.PORT ?? 3310);
const app = express();
app.use(corsMiddleware());
app.use(requestMetaMiddleware());
app.use(express.json({ limit: "2mb" }));

const pg = PostgresClient.create({ connectionString: resolveDatabaseUrl() });
const verifier = await OidcTokenVerifier.fromIssuer(process.env.OIDC_ISSUER!, process.env.OIDC_AUDIENCE!, fetch, {
  ...(process.env.OIDC_DISCOVERY_URL ? { discoveryUrl: process.env.OIDC_DISCOVERY_URL } : {}),
  ...(process.env.OIDC_JWKS_URL ? { jwksUrl: process.env.OIDC_JWKS_URL } : {}),
});
const profiles = new PostgresUserProfileRepository(pg);

app.get("/health/live", (_q, res) => res.json({ status: "ok", service: "service-identity" }));
app.get("/health/ready", async (_q, res) => {
  try { await pg.ping(); res.json({ status: "ready" }); }
  catch { res.status(503).json({ status: "not_ready" }); }
});
app.get("/api/v1/meta", (req, res) => sendSuccess(res, 200, { name: "service-identity", version: process.env.APP_VERSION ?? "0.1.0", contract: "api/v1" }, req.meta));

app.get("/api/v1/me", async (req, res) => {
  const p = await resolvePrincipal(req, verifier);
  if (!p) return sendFailure(res, 401, "UNAUTHENTICATED", "Authentication is required.", req.meta);
  try {
    await profiles.upsertFromOidc({ id: p.subject, ...(p.email ? { email: p.email } : {}), ...(p.name ? { displayName: p.name } : {}) });
  } catch (error) {
    console.error("[identity] /me profile sync failed", error);
    return sendFailure(res, 503, "PROFILE_SYNC_FAILED", "Unable to synchronize the user profile.", req.meta);
  }
  const familyId = await profiles.getActiveFamilyId(p.subject).catch(() => undefined);
  return sendSuccess(res, 200, { id: p.subject, subject: p.subject, issuer: p.issuer, roles: p.roles, scopes: p.scopes, expiresAt: p.expiresAt.toISOString(), ...(p.email ? { email: p.email } : {}), ...(p.name ? { name: p.name } : {}), ...(familyId ? { activeFamilyId: familyId } : {}) }, req.meta);
});

app.get("/api/v1/auth/me", async (req, res) => {
  const p = await resolvePrincipal(req, verifier);
  if (!p) return sendFailure(res, 401, "UNAUTHENTICATED", "Authentication is required.", req.meta);

  // /auth/me is the bootstrap endpoint used by the web client immediately after login/register.
  // It must synchronize the OIDC subject into PostgreSQL before family operations run. Previously
  // only the legacy /me endpoint did this, so a freshly registered Keycloak user had no local
  // users row and the following family bootstrap could fail (and, more importantly, creating a
  // family would violate the family.creator_user_id FK).
  try {
    await profiles.upsertFromOidc({
      id: p.subject,
      ...(p.email ? { email: p.email } : {}),
      ...(p.name ? { displayName: p.name } : {}),
    });
    const familyId = await profiles.getActiveFamilyId(p.subject);
    return sendSuccess(
      res,
      200,
      {
        id: p.subject,
        subject: p.subject,
        email: p.email,
        name: p.name,
        roles: p.roles,
        scopes: p.scopes,
        ...(familyId ? { activeFamilyId: familyId } : {}),
      },
      req.meta,
    );
  } catch (error) {
    console.error("[identity] /auth/me profile sync failed", error);
    return sendFailure(res, 503, "PROFILE_SYNC_FAILED", "Unable to synchronize the user profile.", req.meta);
  }
});

app.post("/api/v1/auth/register", async (req, res) => {
  const parsed = parseRegisterUserInput(req.body);
  if (!parsed) return sendFailure(res, 400, "VALIDATION_ERROR", "Nome, email valida e password di almeno 8 caratteri sono obbligatori.", req.meta);
  try {
    return sendSuccess(res, 201, await registerUser(parsed, resolveKeycloakAdminConfig()), req.meta);
  } catch (error) {
    if (error instanceof RegistrationError) {
      const status = error.code === "USER_ALREADY_EXISTS" ? 409 : error.code === "VALIDATION_ERROR" ? 400 : error.code === "AUTH_SERVICE_UNAVAILABLE" ? 503 : 502;
      return sendFailure(res, status, error.code, error.message, req.meta);
    }
    return sendFailure(res, 500, "REGISTRATION_FAILED", "Registration failed.", req.meta);
  }
});

app.post("/api/v1/auth/reset-password", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email) return sendFailure(res, 400, "VALIDATION_ERROR", "A valid email is required.", req.meta);
  await requestPasswordReset(email, resolveKeycloakAdminConfig());
  return sendSuccess(res, 202, { accepted: true }, req.meta);
});
app.post("/api/v1/auth/logout", (_q, res) => res.status(204).end());
app.use((req, res) => sendFailure(res, 404, "NOT_FOUND_OR_NOT_VISIBLE", "The resource is not available.", req.meta ?? buildMeta(req)));
app.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ service: "service-identity", port })));
