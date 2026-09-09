import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptInvite, resolveJoinEntry, reviewInvite } from "../apps/web/dist/family-journey.js";

test("family-local synthetic journey preserves safe invite and welcome redirects", () => {
  assert.equal(resolveJoinEntry("invite-token").state, "PENDING_AUTHENTICATION");

  const review = reviewInvite({
    familyName: "Casa",
    proposedRole: "MEMBER",
    expiresAt: "2026-12-31T00:00:00.000Z",
    returnTo: "https://attacker.invalid",
  });
  assert.equal(review.state, "PENDING_REVIEW");
  assert.equal(review.returnTo, "/join/review");

  const accepted = acceptInvite("family/one");
  assert.equal(accepted.state, "ACCEPTED");
  assert.equal(accepted.returnTo, "/families/family%2Fone/welcome");
});
