import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PrivacyExportError,
  PrivacyExportService,
  PrivacyExportWorker,
} from "../dist/privacy/export.js";

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
  const audits = [];
  const published = [];
  const jobs = new Map();
  const artifacts = new Map();
  const repository = {
    async createOrGetExport(input) {
      const existing = [...jobs.values()].find(
        (job) => job.familyId === input.familyId && job.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return { job: existing, created: false };
      const job = {
        id: "export-1",
        familyId: input.familyId,
        ownerId: input.ownerId,
        idempotencyKey: input.idempotencyKey,
        status: "PENDING",
        createdAt: input.now,
      };
      jobs.set(job.id, job);
      return { job, created: true };
    },
    async getExport(id) {
      return jobs.get(id);
    },
    async completeExport(input) {
      const job = jobs.get(input.id);
      Object.assign(job, {
        status: "COMPLETED",
        artifactId: input.artifactId,
        expiresAt: input.expiresAt,
      });
      return job;
    },
  };
  return {
    audits,
    published,
    jobs,
    artifacts,
    repository,
    service: new PrivacyExportService(
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
        async put(input) {
          artifacts.set(input.artifactId, input);
        },
        async read(input) {
          const artifact = artifacts.get(input.artifactId);
          assert.equal(artifact.familyId, input.familyId);
          return artifact;
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

test("privacy export creation is owner-only and idempotent", async () => {
  const context = setup();
  const first = await context.service.create(owner, "family-1", "idem-1", "trace-privacy-0001");
  const second = await context.service.create(owner, "family-1", "idem-1", "trace-privacy-0001");
  assert.equal(first.id, second.id);
  assert.equal(context.published.length, 1);
  await assert.rejects(
    () => context.service.create(undefined, "family-1", "idem-2", "trace-privacy-0001"),
    (error) => error instanceof PrivacyExportError && error.code === "UNAUTHENTICATED",
  );
});

test("worker creates expiring family-scoped artifact and owner can download it", async () => {
  const context = setup();
  const job = await context.service.create(owner, "family-1", "idem-1", "trace-privacy-0001");
  const worker = new PrivacyExportWorker(
    context.repository,
    {
      async collectFamilyExport(familyId) {
        return { familyId, inventory: ["redacted-item"] };
      },
    },
    {
      async put(input) {
        context.artifacts.set(input.artifactId, input);
      },
      async read(input) {
        const artifact = context.artifacts.get(input.artifactId);
        assert.equal(artifact.familyId, input.familyId);
        return artifact;
      },
    },
    () => "artifact-1",
    () => 2_000,
    10_000,
  );
  await worker.process(job.id);
  const result = await context.service.download(owner, job.id, "trace-privacy-0002");
  assert.deepEqual(result.content, { familyId: "family-1", inventory: ["redacted-item"] });
  assert.equal(result.expiresAt, 12_000);
});

test("download rejects non-owner and expired artifacts", async () => {
  const context = setup();
  const job = await context.service.create(owner, "family-1", "idem-1", "trace-privacy-0001");
  await context.repository.completeExport({ id: job.id, artifactId: "artifact-1", expiresAt: 900 });
  await assert.rejects(
    () => context.service.download({ ...owner, subject: "member-2" }, job.id, "trace-privacy-0003"),
    (error) => error instanceof PrivacyExportError && error.code === "FORBIDDEN",
  );
  await assert.rejects(
    () => context.service.download(owner, job.id, "trace-privacy-0004"),
    (error) => error instanceof PrivacyExportError && error.code === "EXPORT_EXPIRED",
  );
});
