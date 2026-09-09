import { createHash, randomBytes } from "node:crypto";
import type { FetchLike, OidcDiscoveryDocument } from "./oidc.js";

export interface OidcAuthorizationRequest {
  readonly authorizationUrl: string;
  readonly state: string;
}

export interface OidcTokenResponse {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly expiresIn?: number;
}

interface PendingAuthorization {
  readonly verifier: string;
  readonly createdAt: number;
}

export class AuthorizationCodeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthorizationCodeError";
  }
}

export class LocalOidcAuthorizationFlow {
  private readonly pending = new Map<string, PendingAuthorization>();
  private discovery: OidcDiscoveryDocument | undefined;
  private readonly issuer: string;
  private readonly clientId: string;
  private readonly redirectUri: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly stateTtlMs: number;

  public constructor(
    issuer: string,
    clientId: string,
    redirectUri: string,
    fetchImpl: FetchLike = fetch,
    now: () => number = Date.now,
    stateTtlMs = 10 * 60 * 1000,
  ) {
    this.issuer = issuer;
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.stateTtlMs = stateTtlMs;
    if (!issuer || !clientId || !redirectUri)
      throw new Error("OIDC flow configuration is required.");
    if (stateTtlMs <= 0) throw new Error("OIDC state TTL must be positive.");
  }

  public async begin(): Promise<OidcAuthorizationRequest> {
    const discovery = await this.getDiscovery();
    if (!discovery.authorization_endpoint)
      throw new AuthorizationCodeError("OIDC authorization endpoint is unavailable.");

    this.removeExpired();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    this.pending.set(state, { verifier, createdAt: this.now() });
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid profile email");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: url.toString(), state };
  }

  public async complete(state: string, code: string): Promise<OidcTokenResponse> {
    this.removeExpired();
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || !code.trim()) throw new AuthorizationCodeError("OIDC callback is invalid.");
    const discovery = await this.getDiscovery();
    if (!discovery.token_endpoint)
      throw new AuthorizationCodeError("OIDC token endpoint is unavailable.");

    const response = await this.fetchImpl(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        code,
        code_verifier: pending.verifier,
      }),
    });
    if (!response.ok) throw new AuthorizationCodeError("OIDC token exchange failed.");
    const body: unknown = await response.json();
    return parseTokenResponse(body);
  }

  private async getDiscovery(): Promise<OidcDiscoveryDocument> {
    if (this.discovery) return this.discovery;
    const response = await this.fetchImpl(
      new URL(".well-known/openid-configuration", `${this.issuer.replace(/\/?$/, "/")}`).toString(),
    );
    if (!response.ok) throw new AuthorizationCodeError("OIDC discovery failed.");
    const document = (await response.json()) as Partial<OidcDiscoveryDocument>;
    if (
      document.issuer !== this.issuer ||
      typeof document.jwks_uri !== "string" ||
      typeof document.authorization_endpoint !== "string" ||
      typeof document.token_endpoint !== "string"
    )
      throw new AuthorizationCodeError("OIDC discovery document is invalid.");
    this.discovery = document as OidcDiscoveryDocument;
    return this.discovery;
  }

  private removeExpired(): void {
    const cutoff = this.now() - this.stateTtlMs;
    for (const [state, entry] of this.pending) {
      if (entry.createdAt < cutoff) this.pending.delete(state);
    }
  }
}

function parseTokenResponse(body: unknown): OidcTokenResponse {
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { access_token?: unknown }).access_token !== "string" ||
    typeof (body as { token_type?: unknown }).token_type !== "string"
  )
    throw new AuthorizationCodeError("OIDC token response is invalid.");
  const value = body as {
    access_token: string;
    refresh_token?: unknown;
    token_type: string;
    expires_in?: unknown;
  };
  return {
    accessToken: value.access_token,
    tokenType: value.token_type,
    ...(typeof value.refresh_token === "string" ? { refreshToken: value.refresh_token } : {}),
    ...(typeof value.expires_in === "number" ? { expiresIn: value.expires_in } : {}),
  };
}
