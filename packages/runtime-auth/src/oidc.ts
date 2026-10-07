import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

export interface OidcDiscoveryDocument {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
}

export interface Principal {
  subject: string;
  issuer: string;
  audience: readonly string[];
  expiresAt: Date;
  issuedAt: Date | undefined;
  roles: readonly string[];
  scopes: readonly string[];
  email?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  preferredUsername?: string;
}

export class AuthenticationError extends Error {
  public readonly code = "UNAUTHENTICATED";

  public constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationError";
  }
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class OidcTokenVerifier {
  private readonly keySet:
    ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;

  public constructor(
    issuer: string,
    audience: string,
    keySet: ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>,
  ) {
    this.issuer = issuer;
    this.audience = audience;
    this.keySet = keySet;
  }

  public static async fromIssuer(
    issuer: string,
    audience: string,
    fetchImpl: FetchLike = fetch,
    options: {
      discoveryUrl?: string;
      jwksUrl?: string;
      discoveryAttempts?: number;
      discoveryDelayMs?: number;
      discoveryTimeoutMs?: number;
    } = {},
  ): Promise<OidcTokenVerifier> {
    // In the Docker architecture the service already has an explicit internal JWKS URL.
    // Prefer it so startup never depends on an HTTP discovery request or a public-host redirect.
    if (options.jwksUrl) {
      return new OidcTokenVerifier(
        issuer,
        audience,
        createRemoteJWKSet(new URL(options.jwksUrl)),
      );
    }

    const discoveryUrl = options.discoveryUrl
      ? new URL(options.discoveryUrl)
      : new URL(".well-known/openid-configuration", ensureTrailingSlash(issuer));
    const response = await fetchDiscoveryWithRetry(
      fetchImpl,
      discoveryUrl,
      options.discoveryAttempts ?? 30,
      options.discoveryDelayMs ?? 2_000,
      options.discoveryTimeoutMs ?? 5_000,
    );
    const discovery = (await response.json()) as Partial<OidcDiscoveryDocument>;
    const discoveryIssuer = discovery.issuer?.replace(/\/+$/, "");
    const expectedIssuer = issuer.replace(/\/+$/, "");

    if (
      discoveryIssuer !== expectedIssuer ||
      typeof discovery.jwks_uri !== "string" ||
      discovery.jwks_uri.trim().length === 0
    ) {
      throw new Error("OIDC discovery document is invalid.");
    }

    return new OidcTokenVerifier(
      issuer,
      audience,
      createRemoteJWKSet(new URL(discovery.jwks_uri)),
    );
  }

  public async verifyAuthorizationHeader(authorization: string | undefined): Promise<Principal> {
    if (authorization === undefined || !/^Bearer\s+\S+$/.test(authorization)) {
      throw new AuthenticationError();
    }

    const token = authorization.slice("Bearer".length).trim();
    try {
      const result = await jwtVerify(token, this.keySet, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256", "ES256"],
      });
      return toPrincipal(result.payload);
    } catch {
      throw new AuthenticationError();
    }
  }
}

export function createTestTokenVerifier(
  issuer: string,
  audience: string,
  keys: JSONWebKeySet,
): OidcTokenVerifier {
  return new OidcTokenVerifier(issuer, audience, createLocalJWKSet(keys));
}

function toPrincipal(payload: JWTPayload): Principal {
  if (
    typeof payload.sub !== "string" ||
    typeof payload.iss !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new AuthenticationError();
  }

  return {
    subject: payload.sub,
    issuer: payload.iss,
    audience: normalizeStringArray(payload.aud),
    expiresAt: new Date(payload.exp * 1000),
    issuedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000) : undefined,
    roles: extractRoles(payload),
    scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    ...(typeof payload.given_name === "string" ? { givenName: payload.given_name } : {}),
    ...(typeof payload.family_name === "string" ? { familyName: payload.family_name } : {}),
    ...(typeof payload.preferred_username === "string" ? { preferredUsername: payload.preferred_username } : {}),
  };
}

function extractRoles(payload: JWTPayload): readonly string[] {
  const realmAccess = payload.realm_access;
  if (
    typeof realmAccess !== "object" ||
    realmAccess === null ||
    !("roles" in realmAccess) ||
    !Array.isArray(realmAccess.roles)
  ) {
    return [];
  }
  return realmAccess.roles.filter((role): role is string => typeof role === "string");
}

function normalizeStringArray(value: string | string[] | undefined): readonly string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * Keycloak can take tens of seconds to become reachable after `docker compose up`.
 * Retrying here avoids crashing at startup (top-level await) when the IdP is not ready yet.
 */
async function fetchDiscoveryWithRetry(
  fetchImpl: FetchLike,
  url: URL,
  attempts = 30,
  delayMs = 2_000,
  timeoutMs = 5_000,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (response.ok) {
        clearTimeout(timer);
        return response;
      }
      lastError = new Error(`OIDC discovery failed with status ${response.status}.`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OIDC discovery failed.");
}
