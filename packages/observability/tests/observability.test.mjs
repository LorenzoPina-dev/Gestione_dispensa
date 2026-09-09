import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryLogSink,
  InMemoryMetrics,
  RedactingLogger,
  parseTraceparent,
  readiness,
} from "../src/index.ts";

const context = { requestId: "request-1", traceId: "trace-1", serviceName: "test-service" };

test("RedactingLogger removes sensitive fields recursively and preserves context", () => {
  const sink = new InMemoryLogSink();
  const logger = new RedactingLogger(context, sink);

  logger.info("request complete", {
    status: 200,
    authorization: "Bearer secret",
    nested: { token: "x" },
  });

  assert.equal(sink.records.length, 1);
  assert.equal(sink.records[0].context.requestId, "request-1");
  assert.equal(sink.records[0].attributes.authorization, "[REDACTED]");
  assert.deepEqual(sink.records[0].attributes.nested, { token: "[REDACTED]" });
});

test("InMemoryMetrics rejects invalid names and exports Prometheus samples", () => {
  const metrics = new InMemoryMetrics();
  metrics.increment("http_requests_total", { route: "/health" });
  metrics.observe("http_duration_ms", 12.5);

  assert.ok(metrics.toPrometheus().includes('http_requests_total{route="/health"} 1'));
  assert.throws(() => metrics.increment("BadMetric"), /lowercase snake_case/);
  assert.throws(() => metrics.observe("valid_metric", Number.NaN), /finite/);
});

test("parseTraceparent accepts W3C trace context and falls back safely", () => {
  assert.deepEqual(
    parseTraceparent(
      { traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01" },
      "fallback",
    ),
    { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" },
  );
  assert.deepEqual(parseTraceparent({ traceparent: "invalid" }, "fallback"), {
    traceId: "fallback",
  });
});

test("readiness aggregates all dependency checks", async () => {
  const ready = await readiness([
    { name: "db", check: async () => "up" },
    { name: "redis", check: async () => "up" },
  ]);
  const notReady = await readiness([{ name: "db", check: async () => "down" }]);

  assert.deepEqual(ready, { status: "ready", checks: { db: "up", redis: "up" } });
  assert.deepEqual(notReady, { status: "not_ready", checks: { db: "down" } });
});
