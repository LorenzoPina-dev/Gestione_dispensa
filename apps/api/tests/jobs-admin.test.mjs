import assert from "node:assert/strict";
import { test } from "node:test";
import { JobAdminError, JobAdministrationService } from "../dist/jobs/admin.js";

const operator = {
  subject: "operator-1",
  issuer: "issuer",
  audience: ["api"],
  expiresAt: new Date("2030-01-01"),
  issuedAt: new Date("2026-01-01"),
  roles: ["PLATFORM_OPERATOR"],
  scopes: [],
};

function setup() {
  const audits = [];
  const published = [];
  const repository = {
    async getJob(id) {
      return id === "job-1"
        ? {
            id,
            capability: "inventory.movement",
            status: "FAILED",
            currentAttempt: 2,
            maxAttempts: 2,
            nextAttemptAt: 0,
            createdAt: 1,
            updatedAt: 2,
          }
        : undefined;
    },
    async getDeadLetter(id) {
      return id === "dlq-1"
        ? {
            id,
            jobId: "job-1",
            queue: "core",
            reason: "JOB_ATTEMPTS_EXHAUSTED",
            attempts: 2,
            replayCount: 0,
            failedAt: 2,
            originalCreatedAt: 1,
          }
        : undefined;
    },
    async recordReplay(input) {
      repository.replay = input;
    },
  };
  return {
    audits,
    published,
    repository,
    service: new JobAdministrationService(
      repository,
      {
        async publish(input) {
          published.push(input);
        },
      },
      {
        async append(input) {
          audits.push(input);
        },
      },
      () => "replay-1",
      () => 3,
    ),
  };
}

test("job inspection is operator-only and audit logged", async () => {
  const context = setup();
  const job = await context.service.inspect(operator, "job-1", "trace-1");
  assert.equal(job.status, "FAILED");
  assert.equal(context.audits.at(-1).outcome, "SUCCESS");
  await assert.rejects(
    () => context.service.inspect(undefined, "job-1", "trace-1"),
    (error) => error instanceof JobAdminError && error.code === "UNAUTHENTICATED",
  );
});

test("DLQ replay requires approval, records metadata, publishes, and audits", async () => {
  const context = setup();
  const result = await context.service.replay(operator, "dlq-1", {
    reason: "approved retry after provider recovery",
    approvalId: "change-123",
    traceId: "trace-2",
  });
  assert.deepEqual(result, { replayId: "replay-1", jobId: "job-1" });
  assert.equal(context.repository.replay.approvalId, "change-123");
  assert.equal(context.published[0].queue, "core");
  assert.equal(context.audits.at(-1).action, "dlq.replay");
});

test("DLQ replay rejects missing approval before persistence", async () => {
  const context = setup();
  await assert.rejects(
    () =>
      context.service.replay(operator, "dlq-1", {
        reason: "",
        approvalId: "",
        traceId: "trace-3",
      }),
    (error) => error instanceof JobAdminError && error.code === "APPROVAL_REQUIRED",
  );
  assert.equal(context.repository.replay, undefined);
  assert.equal(context.published.length, 0);
});
