import assert from "node:assert/strict";
import test from "node:test";
import { consumeOidcCallback, createBrowserRuntime, renderPwaDocument } from "./runtime.js";

test("browser runtime exposes explicit offline and family-scoped navigation states", () => {
  const runtime = createBrowserRuntime({
    path: "/inventory",
    principal: { userId: "user-1", displayName: "User" },
    family: { familyId: "family-1", displayName: "Home" },
    online: false,
  });
  assert.equal(runtime.shell.state, "OFFLINE");
  assert.equal(runtime.shell.navigation[0]?.current, true);
  assert.equal(runtime.redirectTo, "/inventory");
  assert.match(renderPwaDocument(runtime.shell), /aria-label="Family navigation"/);
});

test("OIDC callback rejects state mismatch and preserves only a safe redirect", () => {
  const rejected = consumeOidcCallback({
    code: "code-1",
    state: "wrong",
    expectedState: "expected",
    redirectTo: "https://evil.example",
  });
  assert.equal(rejected.shell.state, "ERROR");
  const accepted = consumeOidcCallback({
    code: "code-1",
    state: "expected",
    expectedState: "expected",
    redirectTo: "/shopping",
  });
  assert.equal(accepted.oidcCode, "code-1");
  assert.equal(accepted.redirectTo, "/shopping");
});
