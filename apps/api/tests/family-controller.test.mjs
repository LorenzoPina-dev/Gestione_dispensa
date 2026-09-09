import assert from "node:assert/strict";
import { test } from "node:test";
import { FixedClock, SequenceIdGenerator } from "../../../packages/testkit/src/index.ts";
import { FamilyController, FamilyHttpError } from "../dist/family/controller.js";
import { FamilyService } from "../dist/family/service.js";
import { InviteService } from "../dist/family/invites.js";

const principal = {
  subject: "user-1",
  issuer: "issuer",
  audience: ["api"],
  expiresAt: new Date("2030-01-01"),
  issuedAt: new Date("2026-01-01"),
  roles: [],
  scopes: [],
};
const meta = { requestId: "request-1", traceId: "0123456789abcdef", schemaVersion: "1.0" };

function dependencies(role = "OWNER") {
  const familyRepository = {
    async createFamilyAtomic(input) {
      return input;
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
    async revoke() {},
    async acceptAtomically({ attemptId, userId }) {
      return { id: attemptId, userId, state: "ACCEPTED" };
    },
  };
  const families = new FamilyService(
    familyRepository,
    new SequenceIdGenerator(["family-1", "membership-1", "event-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
  );
  const invites = new InviteService(
    inviteRepository,
    new SequenceIdGenerator(["invite-1", "attempt-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
    { token: () => "token", fallbackCode: () => "123456" },
  );
  const memberships = {
    async getMembership() {
      return { familyId: "family-1", userId: "user-1", role, status: "ACTIVE" };
    },
  };
  return new FamilyController(families, invites, memberships);
}

test("family controller creates family only for an authenticated principal", async () => {
  const controller = dependencies();
  const result = await controller.createFamily(
    principal,
    {
      displayName: "Casa",
      locale: "it-IT",
      timezone: "UTC",
      unitSystem: "METRIC",
      traceId: meta.traceId,
    },
    meta,
  );

  assert.equal(result.data.family.creatorUserId, "user-1");
  await assert.rejects(
    () =>
      controller.createFamily(
        undefined,
        {
          displayName: "Casa",
          locale: "it-IT",
          timezone: "UTC",
          unitSystem: "METRIC",
          traceId: meta.traceId,
        },
        meta,
      ),
    (error) => error instanceof FamilyHttpError && error.status === 401,
  );
});

test("family controller protects invite creation with family admin policy", async () => {
  const controller = dependencies("MEMBER");

  await assert.rejects(
    () =>
      controller.createInvite(
        principal,
        "family-1",
        { role: "MEMBER", expiresInSeconds: 600 },
        meta,
      ),
    (error) => error instanceof FamilyHttpError && error.status === 403,
  );
});

test("family controller maps unavailable invite resolution to non-enumerating 404", async () => {
  const controller = dependencies();

  await assert.rejects(
    () => controller.resolveInvite("tampered", "browser", meta.traceId, meta),
    (error) =>
      error instanceof FamilyHttpError &&
      error.status === 404 &&
      error.code === "NOT_FOUND_OR_NOT_VISIBLE",
  );
});
