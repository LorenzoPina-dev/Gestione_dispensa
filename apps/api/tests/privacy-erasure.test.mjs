import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PrivacyErasureError,
  PrivacyErasureService,
  PrivacyErasureWorker,
} from "../dist/privacy/erasure.js";

const owner = {
  subject: "owner-1",
  issuer: "issuer",
  audience: ["api"],
  expiresAt: new Date("2030-01-01"),
  issuedAt: new Date("2026-01-01"),
  roles: [],
  scopes: [],
};

function setup() {
  const jobs = new Map();
  const consents = new Map();
  const audits = [];
  const published = [];
  const repository = {
    async createOrGetErasure(input) {
      const existing = [...jobs.values()].find(
        (request) =>
          request.familyId === input.familyId && request.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { request: existing, created: false };
      const request = {
        id: "erase-1",
        familyId: input.familyId,
        requesterId: input.requesterId,
        idempotencyKey: input.idempotencyKey,
        status: "REQUESTED",
        createdAt: input.now,
      };
      jobs.set(request.id, request);
      return { request, created: true };
    },
    async getErasure(id) {
      return jobs.get(id);
    },
    async markProcessing(id) {
      jobs.get(id).status = "PROCESSING";
      return jobs.get(id);
    },
    async completeErasure(id, completedAt) {
      Object.assign(jobs.get(id), { status: "COMPLETED", completedAt });
      return jobs.get(id);
    },
    async failErasure(id) {
      jobs.get(id).status = "FAILED";
      return jobs.get(id);
    },
    async upsertConsent(input) {
      consents.set(`${input.userId}:${input.purpose}`, input);
      return input;
    },
    async listConsents(userId) {
      return [...consents.values()].filter((consent) => consent.userId === userId);
    },
  };
  return {
    jobs,
    consents,
    audits,
    published,
    repository,
    service: new PrivacyErasureService(
      repository,
      {
        async getMembership() {
          return { familyId: "family-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" };
        },
      },
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
      () => 1_000,
    ),
  };
}

test("erasure request is owner-only, confirmed and idempotent", async () => {
  const context = setup();
  const first = await context.service.request(
    owner,
    "family-1",
    true,
    "idem-erase",
    "trace-erase-0001",
  );
  const second = await context.service.request(
    owner,
    "family-1",
    true,
    "idem-erase",
    "trace-erase-0001",
  );
  assert.equal(first.id, second.id);
  assert.equal(context.published.length, 1);
  await assert.rejects(
    () => context.service.request(owner, "family-1", false, "idem-2", "trace-erase-0001"),
    (error) => error instanceof PrivacyErasureError && error.code === "CONFIRMATION_REQUIRED",
  );
});

test("consent is persisted only for the authenticated user", async () => {
  const context = setup();
  const consent = await context.service.updateConsent(
    owner,
    "recipe.personalization",
    true,
    "consent-v2",
    "trace-erase-0002",
  );
  assert.equal(consent.userId, "owner-1");
  assert.equal((await context.service.listConsents(owner)).length, 1);
  await assert.rejects(
    () => context.service.updateConsent(owner, "", true, "v1", "trace-erase-0002"),
    (error) => error instanceof PrivacyErasureError && error.code === "INVALID_CONSENT",
  );
});

test("worker anonymizes while preserving legal records and audits completion", async () => {
  const context = setup();
  const request = await context.service.request(
    owner,
    "family-1",
    true,
    "idem-erase",
    "trace-erase-0001",
  );
  const calls = [];
  const worker = new PrivacyErasureWorker(
    context.repository,
    {
      async anonymizeFamily(input) {
        calls.push(input);
      },
    },
    {
      async append(input) {
        context.audits.push(input);
      },
    },
    () => 2_000,
  );
  const completed = await worker.process(request.id, "trace-erase-0003");
  assert.equal(completed.status, "COMPLETED");
  assert.deepEqual(calls[0], {
    familyId: "family-1",
    requesterId: "owner-1",
    preserveLegalRecords: true,
  });
  assert.equal(context.audits.at(-1).outcome, "SUCCESS");
});

test("worker marks failed erasure and does not hide executor errors", async () => {
  const context = setup();
  const request = await context.service.request(
    owner,
    "family-1",
    true,
    "idem-erase",
    "trace-erase-0001",
  );
  const worker = new PrivacyErasureWorker(
    context.repository,
    {
      async anonymizeFamily() {
        throw new Error("retention boundary unavailable");
      },
    },
    {
      async append(input) {
        context.audits.push(input);
      },
    },
    () => 2_000,
  );
  await assert.rejects(
    () => worker.process(request.id, "trace-erase-0004"),
    (error) => error instanceof PrivacyErasureError && error.code === "ERASURE_FAILED",
  );
  assert.equal(context.jobs.get(request.id).status, "FAILED");
  assert.equal(context.audits.at(-1).outcome, "FAILED");
});
