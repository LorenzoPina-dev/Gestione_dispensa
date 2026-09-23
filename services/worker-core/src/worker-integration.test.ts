import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildReconciliationWorker } from "./run.js";
import { jobMessage } from "./worker.js";
import { PostgresJobRepository, PostgresReconciliationRepository } from "./postgres.js";
import { reconciliationHandler } from "./handlers.js";
import { JobError } from "./job.js";

// Opt-in integration test for the real (Postgres + Redis backed)
// reconciliation worker composed in run.ts. Unlike worker.test.ts (which
// exercises JobWorker against FakeQueue/InMemoryJobRepository), this file
// runs the same JobWorker against a live PostgreSQL instance and a live
// Redis instance, closing the "live execution" evidence gap for the job
// queue that was previously entirely untested against real infrastructure.
//
// Skips (does not fail) when DATABASE_URL or REDIS_URL is not set, so
// `npm test` stays green on machines without that infrastructure. Run
// explicitly with:
//   DATABASE_URL=postgresql://user:pass@host:5432/db REDIS_URL=redis://host:6379 \
//     npm run test:integration
// after applying infra/postgres migrations and the init/*.sql bootstrap
// (docker compose --profile family-local up wires both automatically).

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const describeOrSkip = databaseUrl && redisUrl ? test : test.skip;

describeOrSkip(
  "reconciliation worker processes a real job through a real Redis queue and Postgres row",
  async (t) => {
    const queueName = `inventory-reconcile-test-${randomUUID()}`;
    const { worker, postgres, close } = await buildReconciliationWorker({ queueName });
    t.after(close);

    const userId = randomUUID();
    const familyId = randomUUID();
    const productId = randomUUID();
    const stockItemId = randomUUID();
    await postgres.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await postgres.query(
      `INSERT INTO families (id, display_name, creator_user_id, locale, timezone, unit_system)
       VALUES ($1, 'Worker Integration Family', $2, 'it-IT', 'Europe/Rome', 'METRIC')`,
      [familyId, userId],
    );
    await postgres.query(`INSERT INTO data_sources (id, kind, name) VALUES ($1, 'MANUAL', 'integration-test')`, [
      randomUUID(),
    ]);
    await postgres.query(
      `INSERT INTO products (id, canonical_name, default_unit) VALUES ($1, 'Integration Product', 'piece')`,
      [productId],
    );
    await postgres.query(
      `INSERT INTO stock_items (id, family_id, product_id, current_quantity, unit, status, version)
       VALUES ($1, $2, $3, 5, 'piece', 'ACTIVE', 1)`,
      [stockItemId, familyId, productId],
    );
    await postgres.query(
      `INSERT INTO stock_movements
        (family_id, stock_item_id, kind, quantity, unit, source, client_operation_id, occurred_at)
       VALUES ($1, $2, 'RECEIPT', 5, 'piece', 'integration-test', $3, now())`,
      [familyId, stockItemId, randomUUID()],
    );

    const jobRepository = new PostgresJobRepository(postgres);
    const handler = reconciliationHandler(new PostgresReconciliationRepository(postgres));

    const job = await jobRepository.create({
      familyId,
      capability: "inventory.reconcile",
      payload: { familyId },
      idempotencyKey: `integration-${randomUUID()}`,
      maxAttempts: 3,
      now: Date.now(),
    });

    // @ts-expect-error -- `options` is private on JobWorker; reaching into it
    // is acceptable here purely to assert on the real Redis backlog size,
    // which JobWorker does not otherwise expose.
    const queue = worker.options.queue;
    await queue.publish(jobMessage(job, queueName));
    assert.equal(
      await queue.size(),
      1,
      "expected exactly one message in this test's uniquely-named real Redis queue",
    );

    const processed = await worker.processNext(handler);
    assert.equal(processed, true);
    assert.equal(
      await queue.size(),
      0,
      "expected this test's real Redis queue to be empty after ack",
    );

    const completed = await postgres.query<{ status: string; current_attempt: number }>(
      "SELECT status, current_attempt FROM jobs WHERE id = $1",
      [job.id],
    );
    assert.equal(completed.rows[0]?.status, "COMPLETED");
    assert.equal(completed.rows[0]?.current_attempt, 1);

    const attempts = await postgres.query<{ status: string }>(
      "SELECT status FROM job_attempts WHERE job_id = $1",
      [job.id],
    );
    assert.equal(attempts.rows[0]?.status, "COMPLETED");
  },
);

describeOrSkip(
  "a transient handler failure requeues the job and returns the message to the real Redis pending list",
  async (t) => {
    const queueName = `inventory-reconcile-test-${randomUUID()}`;
    const { worker, postgres, close } = await buildReconciliationWorker({ queueName });
    t.after(close);

    const jobRepository = new PostgresJobRepository(postgres);
    const job = await jobRepository.create({
      capability: "inventory.reconcile",
      payload: {},
      idempotencyKey: `integration-retry-${randomUUID()}`,
      maxAttempts: 3,
      now: Date.now(),
    });

    // @ts-expect-error -- see note above.
    const queue = worker.options.queue;
    await queue.publish(jobMessage(job, queueName));

    const flakyHandler = async () => {
      throw new JobError("TRANSIENT_TEST_FAILURE", "TRANSIENT", "simulated transient failure");
    };
    const processed = await worker.processNext(flakyHandler);
    assert.equal(processed, true);

    const afterFailure = await postgres.query<{ status: string; last_error_code: string }>(
      "SELECT status, last_error_code FROM jobs WHERE id = $1",
      [job.id],
    );
    assert.equal(afterFailure.rows[0]?.status, "PENDING");
    assert.equal(afterFailure.rows[0]?.last_error_code, "TRANSIENT_TEST_FAILURE");
    assert.equal(await queue.size(), 1, "expected the nacked message back in the real Redis pending list");
  },
);
