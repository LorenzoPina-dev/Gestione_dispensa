import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryLogSink, RuntimeObservability } from "../src/index.ts";

test("runtime observability attaches service context, redacted logs, metrics, and readiness", async () => {
  const sink = new InMemoryLogSink();
  const runtime = new RuntimeObservability("worker-core", sink);
  runtime.logger({ requestId: "system", traceId: "trace-1" }).info("started", {
    token: "must-not-leak",
  });
  runtime.increment("worker_started_total");
  const ready = await runtime.readiness([{ name: "postgres", check: async () => "up" }]);

  assert.equal(sink.records[0].context.serviceName, "worker-core");
  assert.equal(sink.records[0].attributes.token, "[REDACTED]");
  assert.deepEqual(ready, { status: "ready", checks: { postgres: "up" } });
  assert.equal(runtime.snapshotMetrics()[0].labels.service, "worker-core");
});
