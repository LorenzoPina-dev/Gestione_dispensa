import assert from "node:assert/strict";
import test from "node:test";
import type { JobHandler } from "./job.js";
import { InMemoryMetrics } from "./metrics.js";
import { FakeQueue } from "./queue.js";
import { InMemoryInboxRepository, InMemoryJobRepository } from "./repository.js";
import { WorkerProcess, type WorkerSignalSource } from "./process.js";
import { JobWorker, jobMessage } from "./worker.js";

class Signals implements WorkerSignalSource {
  private readonly listeners = new Map<"SIGINT" | "SIGTERM", () => void>();

  public on(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    this.listeners.set(signal, listener);
  }

  public off(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    if (this.listeners.get(signal) === listener) this.listeners.delete(signal);
  }

  public emit(signal: "SIGINT" | "SIGTERM"): void {
    this.listeners.get(signal)?.();
  }
}

function setup() {
  const repository = new InMemoryJobRepository();
  const queue = new FakeQueue<{ jobId: string }>();
  const worker = new JobWorker({
    queueName: "core",
    consumerName: "worker-core",
    repository,
    inbox: new InMemoryInboxRepository(),
    queue,
    metrics: new InMemoryMetrics(),
    retryPolicy: { baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    now: () => 1_000,
    random: () => 0.5,
  });
  const signals = new Signals();
  return { repository, queue, worker, signals };
}

test("worker process resolves handlers by capability and stops gracefully on signal", async () => {
  const context = setup();
  const job = await context.repository.create({
    capability: "inventory.movement",
    payload: { eventType: "inventory.stock.received" },
    idempotencyKey: "movement-1",
    maxAttempts: 1,
    now: 1_000,
  });
  await context.queue.publish(jobMessage(job, "core"));
  let executions = 0;
  const process = new WorkerProcess({
    worker: context.worker,
    handlers: new Map<string, JobHandler>([
      [
        "inventory.movement",
        async () => {
          executions += 1;
        },
      ],
    ]),
    pollIntervalMs: 0,
    signals: context.signals,
    sleep: async () => {
      context.signals.emit("SIGTERM");
    },
  });

  const running = process.run();
  await running;
  assert.equal(executions, 1);
  assert.equal((await context.repository.get(job.id))?.status, "COMPLETED");
  assert.equal(process.isStopping(), true);
});

test("unsupported capability is classified permanently and acknowledged to DLQ", async () => {
  const context = setup();
  const job = await context.repository.create({
    capability: "unknown",
    payload: {},
    idempotencyKey: "unknown-1",
    maxAttempts: 1,
    now: 1_000,
  });
  const message = jobMessage(job, "core");
  await context.queue.publish(message);
  const process = new WorkerProcess({
    worker: context.worker,
    handlers: new Map(),
    pollIntervalMs: 0,
    signals: context.signals,
    sleep: async () => {
      context.signals.emit("SIGTERM");
    },
  });

  await process.run();
  assert.equal((await context.repository.get(job.id))?.status, "FAILED");
  assert.equal((await context.repository.listDeadLetters()).length, 1);
  assert.equal(context.queue.wasAcknowledged(message.id), true);
});
