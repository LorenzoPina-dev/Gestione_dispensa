import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryNotificationRepository,
  isQuietHours,
  NotificationApplicationService,
  notificationHandler,
  NotificationJobError,
  NotificationValidationError,
} from "./notifications.js";

function job(payload: Readonly<Record<string, unknown>>) {
  return { payload };
}

const event = {
  eventId: "event-1",
  recipientUserId: "user-1",
  channel: "IN_APP",
  category: "REORDER",
  title: "Restock",
  body: "A product needs attention token=secret-value",
  traceId: "trace-1",
} as const;

test("notification delivery is opt-in, idempotent and redacts sensitive text", async () => {
  let sends = 0;
  const completed: string[] = [];
  const handler = notificationHandler(
    {
      async getPreference() {
        return { enabled: true };
      },
      async beginDelivery() {
        return sends === 0;
      },
      async completeDelivery(_eventId, _userId, status) {
        completed.push(status);
      },
      async unsubscribe() {},
    },
    {
      async send(input) {
        sends += 1;
        assert.equal(input.body, "A product needs attention [redacted]");
      },
    },
    { now: () => new Date("2026-01-01T12:00:00Z") },
  );
  const attempt = {
    id: "attempt-1",
    jobId: "job-1",
    attempt: 1,
    startedAt: 0,
    status: "PROCESSING" as const,
  };
  assert.deepEqual(await handler({ job: job(event), attempt }), {
    status: "SENT",
    eventId: "event-1",
  });
  assert.deepEqual(await handler({ job: job(event), attempt }), {
    status: "DUPLICATE",
    eventId: "event-1",
  });
  assert.deepEqual(completed, ["SENT"]);
});

test("quiet hours defer delivery and provider errors are transient", async () => {
  assert.equal(
    isQuietHours({ startHourUtc: 22, endHourUtc: 7 }, new Date("2026-01-01T23:00:00Z")),
    true,
  );
  const handler = notificationHandler(
    {
      async getPreference() {
        return { enabled: true };
      },
      async beginDelivery() {
        return true;
      },
      async completeDelivery(_eventId, _userId, status) {
        assert.equal(status, "FAILED");
      },
      async unsubscribe() {},
    },
    {
      async send() {
        throw new Error("provider down");
      },
    },
    { now: () => new Date("2026-01-01T12:00:00Z") },
  );
  await assert.rejects(
    () =>
      handler({
        job: job(event),
        attempt: { id: "a", jobId: "j", attempt: 1, startedAt: 0, status: "PROCESSING" },
      }),
    (error: unknown) =>
      error instanceof NotificationJobError && error.classification === "TRANSIENT",
  );
});

test("disabled notifications do not invoke providers", async () => {
  let sent = false;
  const handler = notificationHandler(
    {
      async getPreference() {
        return { enabled: false };
      },
      async beginDelivery() {
        return true;
      },
      async completeDelivery() {},
      async unsubscribe() {},
    },
    {
      async send() {
        sent = true;
      },
    },
    { now: () => new Date() },
  );
  const result = await handler({
    job: job(event),
    attempt: { id: "a", jobId: "j", attempt: 1, startedAt: 0, status: "PROCESSING" },
  });
  assert.deepEqual(result, { status: "DISABLED", eventId: "event-1" });
  assert.equal(sent, false);
});

test("preferences, unsubscribe and in-app notification persistence are durable boundaries", async () => {
  const repository = new InMemoryNotificationRepository();
  const service = new NotificationApplicationService(repository);
  await service.updatePreference("user-1", "REORDER", "IN_APP", {
    enabled: true,
  });
  await assert.rejects(
    () =>
      service.updatePreference("user-1", "REORDER", "IN_APP", {
        enabled: true,
        quietHours: { startHourUtc: 24, endHourUtc: 7 },
      }),
    (error: unknown) => error instanceof NotificationValidationError,
  );
  const handler = notificationHandler(
    repository,
    {
      async send(input) {
        await repository.storeInApp({ ...event, title: input.title, body: input.body }, 100);
      },
    },
    { now: () => new Date("2026-01-01T12:00:00Z") },
  );
  await handler({ job: job(event) });
  assert.equal((await service.listNotifications("user-1")).length, 1);
  await service.unsubscribe("user-1", "IN_APP");
  assert.deepEqual(await repository.getPreference("user-1", "REORDER", "IN_APP"), {
    enabled: false,
  });
});
