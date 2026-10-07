import assert from "node:assert/strict";
import { test } from "node:test";
import { metrics, parseTraceparent, renderMetrics } from "../src/index.ts";

test("W3C traceparent parsing accepts valid context and rejects invalid values", () => {
  assert.deepEqual(
    parseTraceparent("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"),
    { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" },
  );
  assert.equal(parseTraceparent("invalid"), undefined);
  assert.equal(
    parseTraceparent("00-00000000000000000000000000000000-0123456789abcdef-01"),
    undefined,
  );
});

test("Prometheus metrics stay bounded and render with declared labels", () => {
  const counter = metrics.counter(
    "architecture_observability_test_total",
    "Test metric.",
    ["kind"],
  );
  counter.inc({ kind: "unit" }, 2);

  const output = renderMetrics();
  assert.match(
    output,
    /architecture_observability_test_total\{kind="unit"\} 2/,
  );
});
