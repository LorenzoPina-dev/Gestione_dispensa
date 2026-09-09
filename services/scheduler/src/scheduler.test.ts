import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySchedulerRepository, Scheduler, type ScheduleDefinition } from "./scheduler.js";

function schedule(nextRunAt = 100): ScheduleDefinition {
  return { id: "expiry", task: "EXPIRY_SCAN", intervalMs: 1_000, nextRunAt, enabled: true };
}

test("scheduler executes only after acquiring the database lock and records audit metadata", async () => {
  const repository = new InMemorySchedulerRepository();
  const traces: string[] = [];
  const scheduler = new Scheduler(
    [schedule()],
    {
      EXPIRY_SCAN: async ({ run }) => {
        traces.push(run.traceId);
      },
    },
    { ownerId: "scheduler-1", repository, leaseMs: 500, now: () => 100, traceId: () => "trace-1" },
  );
  const [run] = await scheduler.tick();
  assert.equal(run?.status, "COMPLETED");
  assert.equal(run?.durationMs, 0);
  assert.deepEqual(traces, ["trace-1"]);
  assert.equal(repository.audit.length, 2);
});

test("a missed schedule is recovered once and advances from the current time", async () => {
  const repository = new InMemorySchedulerRepository();
  const definition = schedule(10);
  const scheduler = new Scheduler(
    [definition],
    { EXPIRY_SCAN: async () => undefined },
    {
      ownerId: "scheduler-1",
      repository,
      leaseMs: 500,
      now: () => 1_000,
      traceId: () => "trace-2",
    },
  );
  const runs = await scheduler.tick(1_000);
  assert.equal(runs.length, 1);
  assert.equal(definition.nextRunAt, 2_000);
});

test("failed tasks remain observable and unconfigured tasks are degraded", async () => {
  const repository = new InMemorySchedulerRepository();
  const failing = new Scheduler(
    [schedule()],
    {
      EXPIRY_SCAN: async () => {
        throw new Error("database unavailable");
      },
    },
    { ownerId: "scheduler-1", repository, leaseMs: 500, now: () => 100 },
  );
  const [failed] = await failing.tick();
  assert.equal(failed?.status, "FAILED");
  assert.equal(failed?.errorCode, "Error");

  const degraded = new Scheduler(
    [{ ...schedule(), id: "retention", task: "RETENTION" }],
    {},
    { ownerId: "scheduler-2", repository, leaseMs: 500, now: () => 100 },
  );
  const [degradedRun] = await degraded.tick();
  assert.equal(degradedRun?.status, "DEGRADED");
  assert.equal(degradedRun?.errorCode, "TASK_NOT_CONFIGURED");
});
