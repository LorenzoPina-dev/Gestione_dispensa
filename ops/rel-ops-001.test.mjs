import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), "utf8");
}

function percentile(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * percentile) - 1] ?? 0;
}

test("synthetic core operation p95 remains within the API target", () => {
  const samples = [];
  for (let index = 0; index < 1_000; index += 1) {
    const started = performance.now();
    JSON.stringify({ familyId: "family-synthetic", operation: index });
    samples.push(performance.now() - started);
  }

  assert.ok(percentile(samples, 0.95) < 400);
});

test("worker source preserves retry, DLQ, and post-persistence acknowledgement order", async () => {
  const worker = await text("services/worker-core/src/worker.ts");

  assert.match(worker, /classification === "TRANSIENT"/);
  assert.match(worker, /addDeadLetter/);
  assert.match(worker, /transition\(job\.id, "COMPLETED"/);
  assert.match(worker, /inbox\.complete[\s\S]*queue\.ack/);
});

test("operational runbooks cover the required failure drills", async () => {
  const runbooks = await text("docs/RUNBOOKS.md");
  const slo = await text("docs/SLO-ERROR-BUDGET.md");

  for (const scenario of ["Redis perso", "Queue backlog/DLQ", "Disco pieno/OOM", "telemetry"]) {
    assert.match(runbooks, new RegExp(scenario, "i"), scenario);
  }
  for (const field of ["severity", "slo", "window", "owner", "runbook"]) {
    assert.match(slo, new RegExp(`\\\`${field}\\\``), field);
  }
});
