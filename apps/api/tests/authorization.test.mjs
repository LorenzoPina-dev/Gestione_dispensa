import assert from "node:assert/strict";
import { test } from "node:test";
import { authorize } from "../src/identity/authorization.ts";

const principal = {
  subject: "user-1",
  issuer: "https://issuer.test",
  audience: ["dispensa-api"],
  expiresAt: new Date("2026-01-01T00:05:00Z"),
  issuedAt: new Date("2026-01-01T00:00:00Z"),
  roles: [],
  scopes: [],
};

function request(action, overrides = {}) {
  return authorize({
    principal,
    action,
    resourceFamilyId: "family-1",
    membership: { familyId: "family-1", userId: "user-1", role: "MEMBER", status: "ACTIVE" },
    ...overrides,
  });
}

test("authorization is deny-by-default for missing principal, membership, and family mismatch", () => {
  assert.equal(
    authorize({ principal: undefined, action: "inventory.read" }).code,
    "UNAUTHENTICATED",
  );
  assert.equal(
    authorize({ principal, action: "inventory.read", resourceFamilyId: "family-1" }).code,
    "NOT_FOUND_OR_NOT_VISIBLE",
  );
  assert.equal(
    request("inventory.read", { resourceFamilyId: "family-2" }).code,
    "NOT_FOUND_OR_NOT_VISIBLE",
  );
  assert.equal(
    request("inventory.read", {
      membership: { familyId: "family-1", userId: "user-1", role: "MEMBER", status: "SUSPENDED" },
    }).code,
    "NOT_FOUND_OR_NOT_VISIBLE",
  );
});

test("member matrix permits reads and operational writes but not administration", () => {
  assert.equal(request("inventory.read").allowed, true);
  assert.equal(request("inventory.write").allowed, true);
  assert.equal(request("shopping.write").allowed, true);
  assert.equal(request("family.admin").allowed, false);
});

test("owner and manager matrix permits administration while viewer is read-only", () => {
  assert.equal(
    request("family.admin", {
      membership: { familyId: "family-1", userId: "user-1", role: "OWNER", status: "ACTIVE" },
    }).allowed,
    true,
  );
  assert.equal(
    request("family.admin", {
      membership: { familyId: "family-1", userId: "user-1", role: "MANAGER", status: "ACTIVE" },
    }).allowed,
    true,
  );
  assert.equal(
    request("inventory.write", {
      membership: { familyId: "family-1", userId: "user-1", role: "VIEWER", status: "ACTIVE" },
    }).allowed,
    false,
  );
  assert.equal(
    request("inventory.read", {
      membership: { familyId: "family-1", userId: "user-1", role: "VIEWER", status: "ACTIVE" },
    }).allowed,
    true,
  );
});

test("operator scope is separate from family membership and owner actions require ownership", () => {
  assert.equal(
    authorize({ principal: { ...principal, scopes: ["operator"] }, action: "operator" }).allowed,
    true,
  );
  assert.equal(authorize({ principal, action: "operator" }).allowed, false);
  assert.equal(authorize({ principal, action: "owner", resourceOwnerId: "user-1" }).allowed, true);
  assert.equal(authorize({ principal, action: "owner", resourceOwnerId: "user-2" }).allowed, false);
});
