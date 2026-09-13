import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer } from "../dist/http.js";
import { FamilyController } from "../dist/family/controller.js";
import { FamilyService } from "../dist/family/service.js";
import { InviteService } from "../dist/family/invites.js";
import { createTestTokenVerifier } from "../dist/identity/oidc.js";

// End-to-end test of the family HTTP surface wired into apps/api/src/http.ts.
// Unlike family-controller.test.mjs (which calls FamilyController methods
// directly), this drives a real node:http server with real fetch() calls, a
// real signed JWT verified against a local JWKS, and asserts on the actual
// wire response. It proves the routing, body parsing, authentication and
// error-mapping added to http.ts, independent of the family/catalog domain
// logic those layers already have their own unit tests for.

const issuer = "https://issuer.example.test/realms/dispensa";
const audience = "dispensa-api";

async function buildFamilyDependencies() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  const verifier = createTestTokenVerifier(issuer, audience, {
    keys: [{ ...publicJwk, alg: "RS256", use: "sig" }],
  });

  const createdFamilies = [];
  const familyRepository = {
    async createFamilyAtomic(input) {
      createdFamilies.push(input);
      return input;
    },
  };
  const memberships = {
    async getMembership() {
      return { familyId: "family-1", userId: "user-1", role: "OWNER", status: "ACTIVE" };
    },
  };
  const inviteRepository = {
    async createInvite() {},
    async findByTokenHash() {
      return undefined;
    },
    async createJoinAttempt() {},
    async getJoinAttempt() {},
    async markExpired() {},
    async revoke() {
      return true;
    },
    async rejectAtomically() {
      throw new Error("not used in this test");
    },
    async acceptAtomically() {
      throw new Error("not used in this test");
    },
  };

  let sequence = 0;
  const ids = { next: () => `id-${(sequence += 1)}` };
  const clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

  const families = new FamilyService(familyRepository, ids, clock);
  const invites = new InviteService(inviteRepository, ids, clock, {
    token: () => "test-token",
    fallbackCode: () => "123456",
  });
  const controller = new FamilyController(families, invites, memberships);

  async function bearerToken() {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope: "family.read", realm_access: { roles: ["MEMBER"] } })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("user-1")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }

  return { controller, verifier, bearerToken, createdFamilies };
}

async function withServer(options, callback) {
  const server = createApiServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("POST /api/v1/families creates a family for an authenticated caller over real HTTP", async () => {
  const { controller, verifier, bearerToken, createdFamilies } = await buildFamilyDependencies();
  await withServer(
    { version: "test", profile: "test", family: { controller, verifier } },
    async (baseUrl) => {
      const token = await bearerToken();
      const response = await fetch(`${baseUrl}/api/v1/families`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Casa Rossi",
          locale: "it-IT",
          timezone: "Europe/Rome",
          unitSystem: "METRIC",
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.data.family.displayName, "Casa Rossi");
      assert.equal(body.data.family.creatorUserId, "user-1");
      assert.equal(createdFamilies.length, 1);
    },
  );
});

test("POST /api/v1/families without a token is rejected with 401", async () => {
  const { controller, verifier } = await buildFamilyDependencies();
  await withServer(
    { version: "test", profile: "test", family: { controller, verifier } },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/families`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Casa Rossi",
          locale: "it-IT",
          timezone: "Europe/Rome",
          unitSystem: "METRIC",
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(body.error.code, "UNAUTHENTICATED");
    },
  );
});

test("POST /api/v1/families rejects an invalid body with 400", async () => {
  const { controller, verifier, bearerToken } = await buildFamilyDependencies();
  await withServer(
    { version: "test", profile: "test", family: { controller, verifier } },
    async (baseUrl) => {
      const token = await bearerToken();
      const response = await fetch(`${baseUrl}/api/v1/families`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ displayName: "" }),
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.error.code, "VALIDATION_ERROR");
    },
  );
});

test("GET on a family route is rejected with 405 (POST-only)", async () => {
  const { controller, verifier } = await buildFamilyDependencies();
  await withServer(
    { version: "test", profile: "test", family: { controller, verifier } },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/families`);
      const body = await response.json();
      assert.equal(response.status, 405);
      assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
    },
  );
});

test("family routes are absent (plain 404) when options.family is not provided", async () => {
  await withServer({ version: "test", profile: "test" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/families`, { method: "POST" });
    assert.equal(response.status, 404);
  });
});

test("/health/ready reflects a real postgres ping when provided", async () => {
  await withServer(
    { version: "test", profile: "test", postgres: { ping: async () => true } },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/ready`);
      const body = await response.json();
      assert.equal(body.data.dependencies.postgres, "ok");
    },
  );
});

test("/health/ready reports unreachable when the postgres ping fails", async () => {
  await withServer(
    { version: "test", profile: "test", postgres: { ping: async () => false } },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health/ready`);
      const body = await response.json();
      assert.equal(body.data.dependencies.postgres, "unreachable");
    },
  );
});
