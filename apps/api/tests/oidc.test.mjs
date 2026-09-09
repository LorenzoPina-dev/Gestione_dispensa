import assert from "node:assert/strict";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  AuthenticationError,
  createTestTokenVerifier,
  OidcTokenVerifier,
} from "../src/identity/oidc.ts";

const issuer = "https://issuer.example.test/realms/dispensa";
const audience = "dispensa-api";

async function createVerifier() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  const verifier = createTestTokenVerifier(issuer, audience, {
    keys: [{ ...publicJwk, alg: "RS256", use: "sig" }],
  });
  return { privateKey, verifier };
}

async function token(
  privateKey,
  { tokenAudience = audience, tokenIssuer = issuer, claims = {} } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: "inventory.read family.read",
    realm_access: { roles: ["MEMBER"] },
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setSubject("user-1")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

test("OIDC verifier maps a valid JWT to a minimal principal", async () => {
  const { privateKey, verifier } = await createVerifier();
  const principal = await verifier.verifyAuthorizationHeader(`Bearer ${await token(privateKey)}`);

  assert.equal(principal.subject, "user-1");
  assert.deepEqual(principal.roles, ["MEMBER"]);
  assert.deepEqual(principal.scopes, ["inventory.read", "family.read"]);
  assert.deepEqual(principal.audience, [audience]);
});

test("OIDC verifier rejects malformed, expired, wrong audience, and wrong issuer tokens", async () => {
  const { privateKey, verifier } = await createVerifier();

  await assert.rejects(() => verifier.verifyAuthorizationHeader(undefined), AuthenticationError);
  await assert.rejects(() => verifier.verifyAuthorizationHeader("Basic abc"), AuthenticationError);
  const wrongAudience = await token(privateKey, { tokenAudience: "other-api" });
  const wrongIssuer = await token(privateKey, { tokenIssuer: "https://other.example.test" });
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(`Bearer ${wrongAudience}`),
    AuthenticationError,
  );
  await assert.rejects(
    () => verifier.verifyAuthorizationHeader(`Bearer ${wrongIssuer}`),
    AuthenticationError,
  );
});

test("OIDC discovery validates issuer and JWKS URI", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ issuer, jwks_uri: "https://issuer.example.test/keys" }), {
      status: 200,
    });
  const verifier = await OidcTokenVerifier.fromIssuer(issuer, audience, fetchImpl);

  assert.ok(verifier instanceof OidcTokenVerifier);
  await assert.rejects(
    () =>
      OidcTokenVerifier.fromIssuer(
        issuer,
        audience,
        async () => new Response(JSON.stringify({ issuer: "wrong" }), { status: 200 }),
      ),
    /discovery document is invalid/,
  );
});
