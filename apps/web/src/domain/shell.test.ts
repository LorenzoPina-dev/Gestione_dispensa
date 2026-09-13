import assert from "node:assert/strict";
import test from "node:test";
import { createShellModel, resolveSafeRedirect, shellStatusMessage } from "./shell.js";

test("shell marks nested routes and exposes only family-safe navigation", () => {
  const model = createShellModel({
    principal: { userId: "user-1", displayName: "Ada" },
    family: { familyId: "family-1", displayName: "Home" },
    state: "READY",
    currentPath: "/inventory/stock-1",
  });
  assert.equal(model.navigation.find((item) => item.href === "/inventory")?.current, true);
  assert.equal(model.navigation.length, 3);
  assert.equal(shellStatusMessage(model), "Working in Home");
});

test("shell represents loading, offline and error states explicitly", () => {
  assert.equal(
    shellStatusMessage(createShellModel({ state: "LOADING" })),
    "Loading family workspace",
  );
  assert.equal(
    shellStatusMessage(createShellModel({ state: "OFFLINE" })),
    "You are offline. Changes will retry when connected.",
  );
  assert.equal(
    shellStatusMessage(createShellModel({ state: "ERROR", errorMessage: "Try again" })),
    "Try again",
  );
});

test("redirects accept only same-origin absolute paths", () => {
  assert.equal(resolveSafeRedirect("/family/invite"), "/family/invite");
  assert.equal(resolveSafeRedirect("https://evil.example"), "/inventory");
  assert.equal(resolveSafeRedirect("//evil.example"), "/inventory");
});
