import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RegistrationError,
  parseRegisterUserInput,
  registerUser,
  resolveKeycloakAdminConfig,
} from "../src/identity/register.ts";

test("parseRegisterUserInput accepts a valid payload and normalizes it", () => {
  const parsed = parseRegisterUserInput({
    name: "  Giulia Ferretti  ",
    email: "  Giulia@Example.IT ",
    password: "password123",
  });
  assert.deepEqual(parsed, {
    name: "Giulia Ferretti",
    email: "giulia@example.it",
    password: "password123",
  });
});

test("parseRegisterUserInput rejects missing/invalid fields", () => {
  assert.equal(parseRegisterUserInput({ name: "", email: "a@b.it", password: "password123" }), undefined);
  assert.equal(parseRegisterUserInput({ name: "A", email: "not-an-email", password: "password123" }), undefined);
  assert.equal(parseRegisterUserInput({ name: "A", email: "a@b.it", password: "short" }), undefined);
  assert.equal(parseRegisterUserInput({ name: "A", email: "a@b.it" }), undefined);
});

test("resolveKeycloakAdminConfig splits the issuer into baseUrl/realm and applies defaults", () => {
  const config = resolveKeycloakAdminConfig({
    OIDC_ISSUER: "https://auth.example.test/realms/dispensa-prod",
    KEYCLOAK_ADMIN: "svc-admin",
    KEYCLOAK_ADMIN_PASSWORD: "secret",
  });
  assert.deepEqual(config, {
    baseUrl: "https://auth.example.test",
    realm: "dispensa-prod",
    adminUsername: "svc-admin",
    adminPassword: "secret",
  });
});

test("resolveKeycloakAdminConfig falls back to local defaults when unset", () => {
  const config = resolveKeycloakAdminConfig({});
  assert.equal(config.baseUrl, "http://localhost:8080");
  assert.equal(config.realm, "dispensa");
  assert.equal(config.adminUsername, "admin");
});

const config = {
  baseUrl: "https://auth.example.test",
  realm: "dispensa",
  adminUsername: "admin",
  adminPassword: "admin-pw",
};
const input = { name: "Giulia Ferretti", email: "giulia@example.it", password: "password123" };

test("registerUser creates the user after obtaining an admin token", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/realms/master/protocol/openid-connect/token")) {
      return new Response(JSON.stringify({ access_token: "admin-token" }), { status: 200 });
    }
    if (url === "https://auth.example.test/admin/realms/dispensa/users") {
      const body = JSON.parse(init.body);
      assert.equal(body.username, "giulia@example.it");
      assert.equal(body.email, "giulia@example.it");
      assert.equal(body.firstName, "Giulia");
      assert.equal(body.lastName, "Ferretti");
      assert.equal(init.headers.authorization, "Bearer admin-token");
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const result = await registerUser(input, config, fetchImpl);
  assert.deepEqual(result, { success: true, message: "Utente registrato con successo." });
  assert.equal(calls.length, 2);
});

test("registerUser maps a 409 from Keycloak to USER_ALREADY_EXISTS", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    return new Response(null, { status: 409 });
  };
  await assert.rejects(
    () => registerUser(input, config, fetchImpl),
    (error) => {
      assert.ok(error instanceof RegistrationError);
      assert.equal(error.code, "USER_ALREADY_EXISTS");
      return true;
    },
  );
});

test("registerUser maps an admin-token failure to AUTH_SERVICE_UNAVAILABLE", async () => {
  const fetchImpl = async () => new Response(null, { status: 500 });
  await assert.rejects(
    () => registerUser(input, config, fetchImpl),
    (error) => {
      assert.ok(error instanceof RegistrationError);
      assert.equal(error.code, "AUTH_SERVICE_UNAVAILABLE");
      return true;
    },
  );
});

test("registerUser maps a non-409 user-creation failure to REGISTRATION_FAILED", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    return new Response(null, { status: 400 });
  };
  await assert.rejects(
    () => registerUser(input, config, fetchImpl),
    (error) => {
      assert.ok(error instanceof RegistrationError);
      assert.equal(error.code, "REGISTRATION_FAILED");
      return true;
    },
  );
});
