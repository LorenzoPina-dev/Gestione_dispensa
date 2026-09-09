import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  artifactDigest,
  createBackupManifest,
  isolatedRestoreTarget,
  redactBackupLog,
  verifyBackupManifest,
  writeBackupManifest,
} from "./backup.mjs";

test("backup manifests contain encrypted artifact references without secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dispensa-backup-"));
  const manifest = createBackupManifest({
    backupId: "backup-1",
    createdAt: "2026-09-09T12:00:00.000Z",
    postgresArtifact: "postgres/backup-1.dump",
    minioArtifact: "minio/backup-1.tar",
  });
  const path = await writeBackupManifest(directory, manifest);
  const stored = await readFile(path, "utf8");
  assert.equal(stored.includes("DATABASE_URL"), false);
  assert.equal((await verifyBackupManifest(path)).verification.status, "VERIFIED");
});

test("restore targets are isolated and backup logs are redacted", () => {
  assert.equal(isolatedRestoreTarget("backups", "backup-1"), "backups\\restore-backup-1");
  assert.throws(() => isolatedRestoreTarget("backups", "../prod"), /BACKUP_ID_INVALID/);
  assert.deepEqual(
    redactBackupLog({ backupId: "backup-1", status: "FAILED", createdAt: "now", secret: "hidden" }),
    { backupId: "backup-1", status: "FAILED", createdAt: "now", errorCode: null },
  );
});

test("artifact digests are deterministic", () => {
  assert.equal(artifactDigest("synthetic"), artifactDigest("synthetic"));
  assert.notEqual(artifactDigest("synthetic"), artifactDigest("changed"));
});
