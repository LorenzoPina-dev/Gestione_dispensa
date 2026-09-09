import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApiServer } from "../src/http.ts";

async function withServer(callback) {
  const server = createApiServer({
    version: "test",
    profile: "test",
    startedAt: "2026-01-01T00:00:00.000Z",
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("health and meta routes return canonical envelopes and correlation headers", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/live?probe=1`, {
      headers: { "x-request-id": "request-test", "x-trace-id": "0123456789abcdef" },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), "request-test");
    assert.equal(body.data.status, "ok");
    assert.equal(body.meta.traceId, "0123456789abcdef");
    assert.equal(body.meta.schemaVersion, "1.0");
  });
});

test("unknown routes and methods use stable error envelopes", async () => {
  await withServer(async (baseUrl) => {
    const notFound = await fetch(`${baseUrl}/api/v1/missing`);
    const notFoundBody = await notFound.json();
    assert.equal(notFound.status, 404);
    assert.equal(notFoundBody.error.code, "NOT_FOUND_OR_NOT_VISIBLE");
    assert.equal(notFoundBody.error.retryable, false);

    const method = await fetch(`${baseUrl}/health/live`, { method: "POST" });
    const methodBody = await method.json();
    assert.equal(method.status, 405);
    assert.equal(methodBody.error.code, "METHOD_NOT_ALLOWED");
  });
});
