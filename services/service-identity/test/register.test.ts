import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RegistrationError,
  parseRegisterUserInput,
  registerUser,
  requestPasswordReset,
  resolveKeycloakAdminConfig,
  type FetchLike,
} from "../src/identity/register.js";

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("service-identity / pure input validation", () => {
  it("accepts and canonicalizes a valid registration", () => {
    assert.deepEqual(
      parseRegisterUserInput({
        name: "  Mario Rossi  ",
        email: "  MARIO@EXAMPLE.COM ",
        password: "password123",
      }),
      { name: "Mario Rossi", email: "mario@example.com", password: "password123" },
    );
  });

  for (const [name, body] of [
    ["missing name", { email: "a@b.com", password: "password123" }],
    ["blank name", { name: "   ", email: "a@b.com", password: "password123" }],
    ["invalid email", { name: "A", email: "not-an-email", password: "password123" }],
    ["short password", { name: "A", email: "a@b.com", password: "1234567" }],
    ["non-string fields", { name: 1, email: "a@b.com", password: "password123" }],
  ] as const) {
    it(`rejects ${name}`, () => assert.equal(parseRegisterUserInput(body), undefined));
  }
});

describe("service-identity / registration flow", () => {
  it("resolves Keycloak configuration from environment", () => {
    assert.deepEqual(
      resolveKeycloakAdminConfig({
        KEYCLOAK_INTERNAL_URL: "http://keycloak:8080///",
        KEYCLOAK_REALM: "dispensa",
        KEYCLOAK_ADMIN: "admin",
        KEYCLOAK_ADMIN_PASSWORD: "secret",
      }),
      {
        baseUrl: "http://keycloak:8080",
        realm: "dispensa",
        adminUsername: "admin",
        adminPassword: "secret",
      },
    );
  });

  it("gets admin token and creates a user with complete Keycloak profile", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/realms/master/protocol/openid-connect/token")) {
        return response(200, { access_token: "admin-token" });
      }
      return response(201);
    };

    const result = await registerUser(
      { name: "Mario Rossi", email: "mario@example.com", password: "password123" },
      { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" },
      fetchMock,
    );

    assert.deepEqual(result, { success: true, message: "Utente registrato con successo." });
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.init?.body as string, /grant_type=password/);
    const createBody = JSON.parse(calls[1]!.init?.body as string);
    assert.equal(createBody.username, "mario@example.com");
    assert.equal(createBody.firstName, "Mario");
    assert.equal(createBody.lastName, "Rossi");
    assert.equal(createBody.enabled, true);
    assert.deepEqual(createBody.requiredActions, []);
    assert.deepEqual(createBody.credentials, [{ type: "password", value: "password123", temporary: false }]);
    assert.equal(calls[1]!.init?.headers && new Headers(calls[1]!.init!.headers).get("authorization"), "Bearer admin-token");
  });

  it("uses first name as last name for single-name users", async () => {
    const calls: RequestInit[] = [];
    const fetchMock: FetchLike = async (_url, init) => {
      calls.push(init ?? {});
      return _url.endsWith("/token") ? response(200, { access_token: "t" }) : response(201);
    };
    await registerUser(
      { name: "Pina", email: "pina@example.com", password: "password123" },
      { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" },
      fetchMock,
    );
    assert.equal(JSON.parse(calls[1]!.body as string).lastName, "Pina");
  });

  it("maps duplicate user to USER_ALREADY_EXISTS", async () => {
    let n = 0;
    const fetchMock: FetchLike = async () => (++n === 1 ? response(200, { access_token: "t" }) : response(409));
    await assert.rejects(
      () => registerUser(
        { name: "Mario Rossi", email: "mario@example.com", password: "password123" },
        { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" },
        fetchMock,
      ),
      (error: unknown) => error instanceof RegistrationError && error.code === "USER_ALREADY_EXISTS",
    );
  });

  it("maps token failure and network failure to AUTH_SERVICE_UNAVAILABLE", async () => {
    const config = { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" };
    await assert.rejects(
      () => registerUser({ name: "Mario Rossi", email: "mario@example.com", password: "password123" }, config, async () => response(503)),
      (e: unknown) => e instanceof RegistrationError && e.code === "AUTH_SERVICE_UNAVAILABLE",
    );
    await assert.rejects(
      () => registerUser({ name: "Mario Rossi", email: "mario@example.com", password: "password123" }, config, async () => { throw new Error("network"); }),
      (e: unknown) => e instanceof RegistrationError && e.code === "AUTH_SERVICE_UNAVAILABLE",
    );
  });

  it("maps unexpected Keycloak create failure to REGISTRATION_FAILED", async () => {
    let n = 0;
    const fetchMock: FetchLike = async () => (++n === 1 ? response(200, { access_token: "t" }) : response(500, { error: "boom" }));
    await assert.rejects(
      () => registerUser(
        { name: "Mario Rossi", email: "mario@example.com", password: "password123" },
        { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" },
        fetchMock,
      ),
      (e: unknown) => e instanceof RegistrationError && e.code === "REGISTRATION_FAILED",
    );
  });
});

describe("service-identity / password reset flow", () => {
  it("is a no-op for invalid email and does not call Keycloak", async () => {
    let calls = 0;
    await requestPasswordReset("invalid", { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" }, async () => {
      calls += 1;
      return response(500);
    });
    assert.equal(calls, 0);
  });

  it("looks up the user and requests UPDATE_PASSWORD", async () => {
    const calls: string[] = [];
    const fetchMock: FetchLike = async (url) => {
      calls.push(url);
      if (url.endsWith("/token")) return response(200, { access_token: "t" });
      if (url.includes("/users?email=")) return response(200, [{ id: "kc-user-1" }]);
      return response(204);
    };
    await requestPasswordReset(" USER@EXAMPLE.COM ", { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" }, fetchMock);
    assert.equal(calls.length, 3);
    assert.match(calls[1]!, /email=user%40example.com/);
    assert.match(calls[2]!, /users\/kc-user-1\/execute-actions-email$/);
  });

  it("remains opaque when Keycloak is unavailable", async () => {
    await assert.doesNotReject(() =>
      requestPasswordReset("user@example.com", { baseUrl: "http://keycloak:8080", realm: "dispensa", adminUsername: "admin", adminPassword: "secret" }, async () => { throw new Error("offline"); }),
    );
  });
});
