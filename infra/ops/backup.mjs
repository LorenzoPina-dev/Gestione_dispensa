import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createBackupManifest(input) {
  if (!input.backupId || !input.createdAt || !input.postgresArtifact || !input.minioArtifact) {
    throw new Error("backupId, createdAt, postgresArtifact and minioArtifact are required");
  }
  return {
    version: 1,
    backupId: input.backupId,
    createdAt: input.createdAt,
    encrypted: true,
    postgres: { artifact: input.postgresArtifact },
    minio: { artifact: input.minioArtifact },
    verification: { status: "PENDING", checkedAt: null },
  };
}

export function redactBackupLog(input) {
  return {
    backupId: input.backupId,
    status: input.status,
    createdAt: input.createdAt,
    errorCode: input.errorCode ?? null,
  };
}

export async function writeBackupManifest(directory, manifest) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${manifest.backupId}.manifest.json`);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return path;
}

export async function verifyBackupManifest(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest.version !== 1 || manifest.encrypted !== true) {
    throw new Error("BACKUP_MANIFEST_INVALID");
  }
  if (!manifest.postgres?.artifact || !manifest.minio?.artifact) {
    throw new Error("BACKUP_ARTIFACT_MISSING");
  }
  const checkedAt = new Date().toISOString();
  const verified = { ...manifest, verification: { status: "VERIFIED", checkedAt } };
  await writeFile(path, `${JSON.stringify(verified, null, 2)}\n`, "utf8");
  return verified;
}

export function isolatedRestoreTarget(baseDirectory, backupId) {
  if (!backupId || backupId.includes("..") || backupId.includes("/") || backupId.includes("\\")) {
    throw new Error("BACKUP_ID_INVALID");
  }
  return join(baseDirectory, `restore-${backupId}`);
}

export function artifactDigest(content) {
  return createHash("sha256").update(content).digest("hex");
}
