import assert from "node:assert/strict";
import test from "node:test";
import { RecognitionPipeline } from "../dist/recognition.js";
import { RecognitionRuntimeService } from "../dist/recognition-runtime.js";

const upload = { filename: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 100 };

function setup() {
  const results = new Map();
  const stored = [];
  const confirmed = [];
  const runtime = new RecognitionRuntimeService(
    new RecognitionPipeline({
      scanner: { scan: async () => "CLEAN" },
      provider: {
        recognize: async () => ({
          providerRequestId: "request-1",
          candidates: [{ name: "Milk", confidence: 0.9, source: "provider" }],
        }),
      },
      maxUploadBytes: 1_000,
      timeoutMs: 50,
      lowConfidenceThreshold: 0.5,
    }),
    {
      getResult: async (jobId) => results.get(jobId),
      saveResult: async ({ jobId, result }) => results.set(jobId, result),
      confirmCandidate: async (input) => confirmed.push(input),
    },
    { put: async (input) => stored.push(input) },
  );
  return { runtime, stored, confirmed };
}

test("recognition runtime quarantines once, persists reviewable result, and is idempotent", async () => {
  const { runtime, stored } = setup();
  const input = {
    jobId: "job-1",
    objectKey: "quarantine/job-1",
    upload,
    traceId: "trace-1234567890123456",
  };
  const first = await runtime.process(input);
  const second = await runtime.process(input);
  assert.equal(first.state, "PENDING_REVIEW");
  assert.deepEqual(second, first);
  assert.equal(stored.length, 1);
});

test("recognition runtime confirms only an explicit candidate operation", async () => {
  const { runtime, confirmed } = setup();
  await runtime.confirm({
    operationId: "op-1",
    actorId: "user-1",
    jobId: "job-1",
    candidateIndex: 0,
    traceId: "trace-1234567890123456",
  });
  assert.equal(confirmed.length, 1);
  await assert.rejects(
    runtime.confirm({
      operationId: "op-2",
      actorId: "user-1",
      jobId: "job-1",
      candidateIndex: -1,
      traceId: "trace-1234567890123456",
    }),
    /non-negative integer/,
  );
});
