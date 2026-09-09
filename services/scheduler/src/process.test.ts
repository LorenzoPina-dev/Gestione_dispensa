import assert from "node:assert/strict";
import test from "node:test";
import { createSchedulerProcess } from "./process.js";
import { InMemorySchedulerRepository, type ScheduleDefinition } from "./scheduler.js";

const schedule: ScheduleDefinition = {
  id: "expiry",
  task: "EXPIRY_SCAN",
  intervalMs: 1_000,
  nextRunAt: 0,
  enabled: true,
};

test("scheduler process starts one polling loop and stops without scheduling another tick", async () => {
  const runs: string[] = [];
  const process = createSchedulerProcess({
    schedules: [{ ...schedule }],
    tasks: {
      EXPIRY_SCAN: async ({ run }) => {
        runs.push(run.traceId);
      },
    },
    repository: new InMemorySchedulerRepository(),
    ownerId: "scheduler-test",
    leaseMs: 100,
    pollIntervalMs: 10,
    now: () => Date.now(),
    traceId: () => "trace-process",
    onRuns: (completed) => {
      if (completed.length > 0) runs.push("observed");
    },
  });

  process.start();
  assert.equal(process.isRunning(), true);
  process.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await process.stop();
  assert.equal(process.isRunning(), false);
  assert.equal(process.scheduler.isStopped(), true);
  assert.ok(runs.includes("trace-process"));
  assert.ok(runs.includes("observed"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runs.length, 2);
});

test("scheduler process rejects invalid polling intervals", () => {
  assert.throws(
    () =>
      createSchedulerProcess({
        schedules: [],
        tasks: {},
        repository: new InMemorySchedulerRepository(),
        ownerId: "scheduler-test",
        leaseMs: 100,
        pollIntervalMs: 0,
      }),
    /poll interval/,
  );
});
