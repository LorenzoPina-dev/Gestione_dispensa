import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMetrics } from "./metrics.js";
import { JobError } from "./job.js";
import { InMemoryInboxRepository, InMemoryJobRepository } from "./repository.js";
import { FakeQueue } from "./queue.js";
import { JobWorker, jobMessage } from "./worker.js";

function setup(maxAttempts = 2) {
  const repository = new InMemoryJobRepository();
  const inbox = new InMemoryInboxRepository();
  const queue = new FakeQueue<{ jobId: string }>();
  const metrics = new InMemoryMetrics();
  let now = 1_000;
  const worker = new JobWorker({
    queueName: "core",
    consumerName: "worker-core",
    repository,
    inbox,
    queue,
    metrics,
    retryPolicy: { baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    now: () => now,
    random: () => 0.5,
  });
  return {
    repository,
    inbox,
    queue,
    metrics,
    worker,
    advance: (ms: number) => {
      now += ms;
    },
    maxAttempts,
  };
}

test("ack happens only after handler side effect resolves", async () => {
  const context = setup();
  const job = await context.repository.create({
    capability: "TEST",
    payload: { value: 1 },
    idempotencyKey: "one",
    maxAttempts: 1,
    now: 1_000,
  });
  const message = jobMessage(job, "core");
  await context.queue.publish(message);
  let sideEffect = false;
  await context.worker.processNext(async () => {
    sideEffect = true;
    return { ok: true };
  });
  assert.equal(sideEffect, true);
  assert.equal(context.queue.wasAcknowledged(message.id), true);
  assert.equal((await context.repository.get(job.id))?.status, "COMPLETED");
});

test("transient failures are bounded and deterministic", async () => {
  const context = setup(2);
  const job = await context.repository.create({
    capability: "TEST",
    payload: {},
    idempotencyKey: "retry",
    maxAttempts: 2,
    now: 1_000,
  });
  await context.queue.publish(jobMessage(job, "core"));
  const handler = async () => {
    throw new JobError("TEMPORARY", "TRANSIENT", "retry");
  };
  await context.worker.processNext(handler);
  assert.equal((await context.repository.get(job.id))?.status, "PENDING");
  context.advance(10);
  await context.worker.processNext(handler);
  assert.equal((await context.repository.get(job.id))?.status, "FAILED");
  assert.equal((await context.repository.listDeadLetters()).length, 1);
});

test("duplicate delivery is ignored by inbox", async () => {
  const context = setup(1);
  const job = await context.repository.create({
    capability: "TEST",
    payload: {},
    idempotencyKey: "duplicate",
    maxAttempts: 1,
    now: 1_000,
  });
  const message = jobMessage(job, "core");
  await context.queue.publish(message);
  await context.worker.processNext(async () => ({ ok: true }));
  await context.queue.publish(message);
  let executions = 0;
  await context.worker.processNext(async () => {
    executions += 1;
  });
  assert.equal(executions, 0);
});
