/**
 * Self-registration e reset password contro il realm Keycloak.
 *
 * Il browser raggiunge questo codice solo attraverso: nginx -> gateway -> service-identity.
 * Le credenziali admin di Keycloak restano nel backend e non vengono mai esposte al browser.
 * Dopo la registrazione il browser esegue da sé il password grant su /realms/dispensa (via nginx).
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
  /** URL interno di Keycloak (rete docker), usato solo per le chiamate admin. */
  readonly baseUrl: string;
  readonly realm: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function resolveKeycloakAdminConfig(env: NodeJS.ProcessEnv = process.env): KeycloakAdminConfig {
  const baseUrl = (env.KEYCLOAK_INTERNAL_URL || "http://keycloak:8080").replace(/\/+$/, "");
  return {
    baseUrl,
    realm: env.KEYCLOAK_REALM || "dispensa",
    adminUsername: env.KEYCLOAK_ADMIN || "admin",
    adminPassword: env.KEYCLOAK_ADMIN_PASSWORD || "admin",
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRegisterUserInput(body: Record<string, unknown>): RegisterUserInput | undefined {
  const { name, email, password } = body;
  if (typeof name !== "string" || name.trim().length === 0) return undefined;
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) return undefined;
  if (typeof password !== "string" || password.length < 8) return undefined;
  return { name: name.trim(), email: email.trim().toLowerCase(), password };
}

const UNAVAILABLE = "Impossibile contattare il servizio di autenticazione.";

async function getAdminToken(config: KeycloakAdminConfig, fetchImpl: FetchLike): Promise<string> {
  try {
    const response = await fetchImpl(`${config.baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: config.adminUsername,
        password: config.adminPassword,
      }).toString(),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ service: "service-identity", event: "keycloak.admin_token_failed", status: response.status }));
      throw new RegistrationError("AUTH_SERVICE_UNAVAILABLE", UNAVAILABLE);
    }
    const body = (await response.json()) as { access_token?: unknown };
    if (typeof body.access_token !== "string") throw new RegistrationError("AUTH_SERVICE_UNAVAILABLE", UNAVAILABLE);
    return body.access_token;
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    throw new RegistrationError("AUTH_SERVICE_UNAVAILABLE", UNAVAILABLE);
  }
}

export async function registerUser(
  input: RegisterUserInput,
  config: KeycloakAdminConfig,
  fetchImpl: FetchLike = fetch,
): Promise<RegisterUserResult> {
  const adminToken = await getAdminToken(config, fetchImpl);

  const [firstName, ...rest] = input.name.split(/\s+/);
  // Keycloak 26 richiede firstName e lastName nel profilo utente: con un lastName vuoto l'account
  // viene creato ma il login fallisce con "Account is not fully set up".
  const lastName = rest.join(" ") || firstName;

  let createResponse: Response;
  try {
    createResponse = await fetchImpl(`${config.baseUrl}/admin/realms/${config.realm}/users`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        firstName,
        lastName,
        enabled: true,
        emailVerified: true,
        requiredActions: [],
        credentials: [{ type: "password", value: input.password, temporary: false }],
      }),
    });
  } catch {
    throw new RegistrationError("AUTH_SERVICE_UNAVAILABLE", UNAVAILABLE);
  }

  if (createResponse.status === 409) {
    throw new RegistrationError("USER_ALREADY_EXISTS", "Un utente con questa email risulta già registrato.");
  }
  if (!createResponse.ok) {
    console.error(JSON.stringify({
      service: "service-identity",
      event: "keycloak.create_user_failed",
      status: createResponse.status,
      body: (await createResponse.text().catch(() => "")).slice(0, 500),
    }));
    throw new RegistrationError("REGISTRATION_FAILED", "Errore durante la creazione dell'account.");
  }

  return { success: true, message: "Utente registrato con successo." };
}

/** Risposta sempre opaca: il reset password non deve rivelare se l'account esiste. */
export async function requestPasswordReset(
  email: string,
  config: KeycloakAdminConfig,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) return;
  try {
    const adminToken = await getAdminToken(config, fetchImpl);
    const usersResponse = await fetchImpl(
      `${config.baseUrl}/admin/realms/${config.realm}/users?email=${encodeURIComponent(normalized)}&exact=true`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    if (!usersResponse.ok) return;
    const users = (await usersResponse.json()) as Array<{ id?: unknown }>;
    const userId = users.find((u) => typeof u.id === "string")?.id;
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
    // volutamente silenzioso
  }
}
