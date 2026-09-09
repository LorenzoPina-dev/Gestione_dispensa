import assert from "node:assert/strict";
import test from "node:test";
import { acceptInvite, resolveJoinEntry, reviewInvite } from "./family-journey.js";

test("join entry never exposes details for a missing token", () => {
  const result = resolveJoinEntry(undefined);
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.familyName, undefined);
});

test("review preserves only safe return paths and limited invite data", () => {
  const result = reviewInvite({
    familyName: "Casa",
    proposedRole: "MEMBER",
    expiresAt: "2026-09-09T14:10:00Z",
    returnTo: "https://evil.example",
  });
  assert.equal(result.state, "PENDING_REVIEW");
  assert.equal(result.returnTo, "/join/review");
  assert.equal(result.familyName, "Casa");
  assert.equal(result.proposedRole, "MEMBER");
});

test("accept redirects to the encoded family welcome route", () => {
  assert.equal(acceptInvite("family/one").returnTo, "/families/family%2Fone/welcome");
});
