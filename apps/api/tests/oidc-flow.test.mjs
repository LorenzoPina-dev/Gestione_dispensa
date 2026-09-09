import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthorizationCodeError, LocalOidcAuthorizationFlow } from "../src/identity/oidc-flow.ts";

const issuer = "http://localhost:8080/realms/dispensa";
const authorizationEndpoint = `${issuer}/protocol/openid-connect/auth`;
const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;

test("OIDC flow creates S256 PKCE authorization requests and exchanges a one-time callback", async () => {
  const requests = [];
  const flow = new LocalOidcAuthorizationFlow(
    issuer,
    "dispensa-web",
    "http://localhost:3000/callback",
    async (input, init) => {
      requests.push({ input: String(input), init });
      if (init?.method === "POST")
        return new Response(
          JSON.stringify({ access_token: "access", token_type: "Bearer", expires_in: 300 }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({
          issuer,
          jwks_uri: `${issuer}/certs`,
          authorization_endpoint: authorizationEndpoint,
          token_endpoint: tokenEndpoint,
        }),
        { status: 200 },
      );
    },
  );

  const started = await flow.begin();
  const url = new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("client_id"), "dispensa-web");
  assert.equal(url.searchParams.get("state"), started.state);
  assert.match(url.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]+$/);

  const token = await flow.complete(started.state, "code");
  assert.equal(token.accessToken, "access");
  assert.equal(requests.at(-1).init.headers["content-type"], "application/x-www-form-urlencoded");
  await assert.rejects(() => flow.complete(started.state, "code"), AuthorizationCodeError);
});

test("OIDC flow rejects malformed discovery and invalid callback input", async () => {
  const flow = new LocalOidcAuthorizationFlow(
    issuer,
    "dispensa-web",
    "http://localhost:3000/callback",
    async () => new Response(JSON.stringify({ issuer }), { status: 200 }),
  );
  await assert.rejects(() => flow.begin(), /discovery document is invalid/);
  await assert.rejects(() => flow.complete("unknown", "code"), AuthorizationCodeError);
});
