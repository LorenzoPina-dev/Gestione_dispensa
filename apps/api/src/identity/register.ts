/**
 * User self-registration against the Keycloak realm used for OIDC auth.
 *
 * This project has no password-auth server of its own: user records live in Keycloak, and
 * `OidcTokenVerifier` only ever verifies bearer tokens issued by it (see `./oidc.ts`). To let the
 * web app's Register screen create an account, this module talks to the Keycloak Admin REST API
 * with a service-account/admin credential (never exposed to the browser) and creates the user
 * there. The web app then performs its own Resource Owner Password Credentials grant directly
 * against Keycloak to obtain a token (see `apps/web/src/pages/auth/Register.tsx`).
 *
 * Previously this file was written against Fastify (`FastifyInstance`, `server.post`). `apps/api`
 * has never depended on Fastify (see package.json) and the real HTTP surface is the plain
 * `node:http` router in `../http.ts`, so that version could not even be imported. This module now
 * follows the same plain-function-returning-a-typed-result shape as the rest of the codebase
 * (e.g. `family/invites.ts`) so `http.ts` can call it directly.
 */

export interface RegisterUserInput {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface RegisterUserResult {
  readonly success: true;
  readonly message: string;
}

export type RegistrationErrorCode =
  | "VALIDATION_ERROR"
  | "USER_ALREADY_EXISTS"
  | "AUTH_SERVICE_UNAVAILABLE"
  | "REGISTRATION_FAILED";

export class RegistrationError extends Error {
  public readonly code: RegistrationErrorCode;

  public constructor(code: RegistrationErrorCode, message: string) {
    super(message);
    this.name = "RegistrationError";
    this.code = code;
  }
}

export interface KeycloakAdminConfig {
  readonly baseUrl: string;
  /** Internal Keycloak base URL used by the API for admin calls. */
  readonly realm: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Reads Keycloak admin connection settings from the environment (same variables as before). */
export function resolveKeycloakAdminConfig(env: NodeJS.ProcessEnv = process.env): KeycloakAdminConfig {
  const issuer = env.OIDC_ISSUER || "https://192.168.1.24:8443/realms/dispensa";
  const [publicBaseUrl, realm] = splitIssuer(issuer);
  const baseUrl = (env.KEYCLOAK_INTERNAL_URL || publicBaseUrl).replace(/\/+$/, "");
  return {
    baseUrl,
    realm,
    adminUsername: env.KEYCLOAK_ADMIN || "admin",
    adminPassword: env.KEYCLOAK_ADMIN_PASSWORD || "change-me-local-only",
  };
}

function splitIssuer(issuer: string): [baseUrl: string, realm: string] {
  const marker = "/realms/";
  const index = issuer.indexOf(marker);
  if (index === -1) return [issuer.replace(/\/+$/, ""), "dispensa"];
  return [issuer.slice(0, index), issuer.slice(index + marker.length) || "dispensa"];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the incoming payload shape. Returns the trimmed/normalized input, or `undefined`. */
export function parseRegisterUserInput(body: Record<string, unknown>): RegisterUserInput | undefined {
  const { name, email, password } = body;
  if (typeof name !== "string" || name.trim().length === 0) return undefined;
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) return undefined;
  if (typeof password !== "string" || password.length < 8) return undefined;
  return { name: name.trim(), email: email.trim().toLowerCase(), password };
}

/**
 * Creates the user in Keycloak via the Admin REST API. Throws `RegistrationError` for every
 * documented failure mode; callers (the HTTP layer) map `.code` to a status code the same way
 * every other domain error is mapped in `http.ts`.
 */
export async function registerUser(
  input: RegisterUserInput,
  config: KeycloakAdminConfig,
  fetchImpl: FetchLike = fetch,
): Promise<RegisterUserResult> {
  let adminToken: string;
  try {
    const tokenResponse = await fetchImpl(
      `${config.baseUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: config.adminUsername,
          password: config.adminPassword,
        }).toString(),
      },
    );
    if (!tokenResponse.ok) {
      throw new RegistrationError(
        "AUTH_SERVICE_UNAVAILABLE",
        "Impossibile contattare il servizio di autenticazione.",
      );
    }
    const tokenBody = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof tokenBody.access_token !== "string") {
      throw new RegistrationError(
        "AUTH_SERVICE_UNAVAILABLE",
        "Impossibile contattare il servizio di autenticazione.",
      );
    }
    adminToken = tokenBody.access_token;
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    throw new RegistrationError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Impossibile contattare il servizio di autenticazione.",
    );
  }

  const [firstName, ...rest] = input.name.split(" ");
  const lastName = rest.join(" ");

  let createResponse: Response;
  try {
    createResponse = await fetchImpl(`${config.baseUrl}/admin/realms/${config.realm}/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        firstName,
        lastName,
        enabled: true,
        emailVerified: true,
        credentials: [{ type: "password", value: input.password, temporary: false }],
      }),
    });
  } catch {
    throw new RegistrationError(
      "AUTH_SERVICE_UNAVAILABLE",
      "Impossibile contattare il servizio di autenticazione.",
    );
  }

  if (createResponse.status === 409) {
    throw new RegistrationError(
      "USER_ALREADY_EXISTS",
      "Un utente con questa email risulta già registrato.",
    );
  }
  if (!createResponse.ok) {
    throw new RegistrationError("REGISTRATION_FAILED", "Errore durante la creazione dell'account.");
  }

  return { success: true, message: "Utente registrato con successo." };
}


export async function requestPasswordReset(
  email: string,
  config: KeycloakAdminConfig,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) return;
  let adminToken: string | undefined;
  try {
    const tokenResponse = await fetchImpl(
      `${config.baseUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password", client_id: "admin-cli",
          username: config.adminUsername, password: config.adminPassword,
        }).toString(),
      },
    );
    if (!tokenResponse.ok) return;
    const body = await tokenResponse.json() as { access_token?: unknown };
    if (typeof body.access_token !== "string") return;
    adminToken = body.access_token;
    const usersResponse = await fetchImpl(
      `${config.baseUrl}/admin/realms/${config.realm}/users?email=${encodeURIComponent(normalized)}&exact=true`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    if (!usersResponse.ok) return;
    const users = await usersResponse.json() as Array<{ id?: unknown }>;
    const userId = users.find(u => typeof u.id === "string")?.id;
    if (typeof userId !== "string") return;
    await fetchImpl(
      `${config.baseUrl}/admin/realms/${config.realm}/users/${encodeURIComponent(userId)}/execute-actions-email`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify(["UPDATE_PASSWORD"]),
      },
    );
  } catch {
    // Deliberately opaque: password reset must not disclose account existence.
  }
}
