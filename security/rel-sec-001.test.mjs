import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("authorization policy is deny-by-default and enforces family scope", async () => {
  const policy = await source("apps/api/src/identity/authorization.ts");

  assert.match(policy, /principal === undefined/);
  assert.match(policy, /membership\.status !== "ACTIVE"/);
  assert.match(policy, /resourceFamilyId !== request\.membership\.familyId/);
  assert.match(policy, /return deny\("NOT_FOUND_OR_NOT_VISIBLE"\)/);
});

test("observability redacts sensitive attributes", async () => {
  const observability = await source("packages/observability/src/index.ts");

  assert.match(observability, /token\|secret\|password\|cookie\|authorization/);
  assert.match(observability, /\[REDACTED\]/);
});

test("runtime configuration contains no concrete secret assignments", async () => {
  const paths = [
    "docker-compose.yml",
    "infra/compose/docker-compose.yml",
    "infra/identity/keycloak/README.md",
    "infra/storage/minio/README.md",
  ];
  const assignment =
    /\b(password|secret|token|api[_-]?key)\s*[:=]\s*(?!\$\{|<|CHANGE_ME|\[REDACTED\]|$)[^#\r\n]+/i;

  for (const path of paths) {
    try {
      const content = await source(path);
      assert.doesNotMatch(content, assignment, path);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
});

test("threat model documents required security gates", async () => {
  const threatModel = await source("docs/THREAT-MODEL.md");

  for (const control of ["SSRF", "CSRF", "XSS", "rate limit", "secret scan", "authorization"]) {
    assert.match(threatModel, new RegExp(control, "i"), control);
  }
});
