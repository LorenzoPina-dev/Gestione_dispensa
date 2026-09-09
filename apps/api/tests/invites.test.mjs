import assert from "node:assert/strict";
import { test } from "node:test";
import { FixedClock, SequenceIdGenerator } from "../../../packages/testkit/src/index.ts";
import { InviteService, InviteUnavailableError, hashSecret } from "../src/family/invites.ts";

function repository() {
  const invites = [];
  const attempts = [];
  return {
    invites,
    attempts,
    async createInvite(record) {
      invites.push(record);
    },
    async findByTokenHash(tokenHash) {
      return invites.find((invite) => invite.tokenHash === tokenHash);
    },
    async createJoinAttempt(attempt) {
      attempts.push(attempt);
    },
    async getJoinAttempt(id) {
      return attempts.find((attempt) => attempt.id === id);
    },
    async markExpired(inviteId) {
      invites.find((invite) => invite.id === inviteId).status = "EXPIRED";
    },
    async revoke(inviteId) {
      invites.find((invite) => invite.id === inviteId).status = "REVOKED";
    },
    async acceptAtomically({ attemptId, userId }) {
      const attempt = attempts.find((candidate) => candidate.id === attemptId);
      attempt.userId = userId;
      attempt.state = "ACCEPTED";
      return attempt;
    },
  };
}

const tokenGenerator = { token: () => "opaque-token", fallbackCode: () => "123456" };

test("invite creation stores only hashes and returns raw credentials once", async () => {
  const repo = repository();
  const service = new InviteService(
    repo,
    new SequenceIdGenerator(["invite-1", "attempt-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
    tokenGenerator,
  );
  const result = await service.createInvite({
    familyId: "family-1",
    actorId: "user-1",
    role: "MEMBER",
    expiresInSeconds: 600,
  });

  assert.equal(result.qrPayload, "opaque-token");
  assert.equal(result.fallbackCode, "123456");
  assert.equal(repo.invites[0].tokenHash, hashSecret("opaque-token"));
  assert.equal(repo.invites[0].fallbackCodeHash, hashSecret("123456"));
  assert.notEqual(repo.invites[0].tokenHash, "opaque-token");
});

test("resolve creates a pending authentication attempt and rejects tampered/expired tokens", async () => {
  const repo = repository();
  const service = new InviteService(
    repo,
    new SequenceIdGenerator(["invite-1", "attempt-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
    tokenGenerator,
  );
  await service.createInvite({
    familyId: "family-1",
    actorId: "user-1",
    role: "MEMBER",
    expiresInSeconds: 600,
  });
  const attempt = await service.resolve("opaque-token", "browser-hash", "0123456789abcdef");

  assert.equal(attempt.state, "PENDING_AUTHENTICATION");
  assert.equal(attempt.browserBindingHash, "browser-hash");
  await assert.rejects(
    () => service.resolve("tampered", "browser-hash", "0123456789abcdef"),
    InviteUnavailableError,
  );
});

test("accept delegates atomic membership consumption and requires consent", async () => {
  const repo = repository();
  const service = new InviteService(
    repo,
    new SequenceIdGenerator(["invite-1", "attempt-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
    tokenGenerator,
  );
  await service.createInvite({
    familyId: "family-1",
    actorId: "user-1",
    role: "MEMBER",
    expiresInSeconds: 600,
  });
  const attempt = await service.resolve("opaque-token", "browser-hash", "0123456789abcdef");

  await assert.rejects(() => service.accept(attempt.id, "user-2", ""), /Consent version/);
  assert.equal((await service.accept(attempt.id, "user-2", "privacy-v1")).state, "ACCEPTED");
});
