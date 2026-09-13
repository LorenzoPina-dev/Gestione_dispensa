import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptInviteRoute,
  beginInviteEntry,
  completeFamilyCreation,
  completeFamilySwitch,
  rejectInvite,
  reviewInviteRoute,
  startFamilyCreation,
  startOnboarding,
  switchFamily,
} from "./family-onboarding.js";

test("onboarding creates a family and redirects to its encoded welcome route", () => {
  assert.equal(startOnboarding().state, "NO_FAMILY");
  assert.equal(
    startFamilyCreation({ displayName: "Casa", returnTo: "https://evil.example" }).route,
    "/onboarding",
  );
  const result = completeFamilyCreation({ familyId: "family/one", displayName: "Casa" });
  assert.equal(result.state, "ACCEPTED");
  assert.equal(result.route, "/families/family%2Fone/welcome");
});

test("invite flow keeps missing tokens generic and exposes only review routes", () => {
  assert.equal(beginInviteEntry(undefined).state, "ERROR");
  const review = reviewInviteRoute({ attemptId: "attempt/one", familyName: "Casa" });
  assert.equal(review.state, "PENDING_REVIEW");
  assert.equal(review.route, "/join/attempt%2Fone/review");
  assert.equal(acceptInviteRoute("attempt/one").state, "ACCEPTING");
  assert.equal(rejectInvite("attempt/one").route, "/inventory");
});

test("family switching requires a different target and activates the new context", () => {
  assert.equal(
    switchFamily({ currentFamilyId: "family-1", targetFamilyId: "family-1" }).state,
    "ERROR",
  );
  const switching = switchFamily({ currentFamilyId: "family-1", targetFamilyId: "family/2" });
  assert.equal(switching.state, "SWITCHING");
  const active = completeFamilySwitch({ familyId: "family/2", familyName: "Second home" });
  assert.equal(active.state, "ACTIVE");
  assert.equal(active.activeFamilyId, "family/2");
});
