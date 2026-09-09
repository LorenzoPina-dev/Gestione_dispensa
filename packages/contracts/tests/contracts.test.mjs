import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateEventEnvelope, validateJobEnvelope, validateJsonSchema } from "../src/index.ts";

const eventDirectory = new URL("../events/", import.meta.url);
const jobDirectory = new URL("../jobs/", import.meta.url);
const openApiDocument = new URL("../../../docs/openapi.yaml", import.meta.url);

test("all event schema files are valid JSON documents", async () => {
  const files = (await readdir(eventDirectory)).filter((file) => file.endsWith(".json"));

  assert.ok(files.length >= 10);
  await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(new URL(file, eventDirectory), "utf8"))),
  );
});

test("event envelope validator requires household scope and payload", () => {
  const invalid = validateEventEnvelope({ eventType: "inventory.stock.received" });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.path === "$.householdId"));

  const valid = validateEventEnvelope({
    eventId: "event-1",
    eventType: "inventory.stock.received",
    eventVersion: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    aggregateType: "stock_item",
    aggregateId: "stock-1",
    householdId: "family-1",
    actorType: "SYSTEM",
    traceId: "0123456789abcdef",
    schemaRef: "events/inventory.stock.received.v1.json",
    payload: { stockItemId: "stock-1" },
  });

  assert.deepEqual(valid, { valid: true, issues: [] });
});

test("registered event schemas are present and reject unknown or missing payload fields", async () => {
  const registry = JSON.parse(await readFile(new URL("registry.v1.json", eventDirectory), "utf8"));
  const files = new Set(await readdir(eventDirectory));

  for (const reference of registry.items.enum) {
    const file = `${reference}.json`;
    assert.ok(files.has(file), `missing registered event schema: ${file}`);
    const schema = JSON.parse(await readFile(new URL(file, eventDirectory), "utf8"));
    assert.ok(Array.isArray(schema.required) && schema.required.length > 0);
    assert.equal(schema.additionalProperties, false);
  }

  const schema = JSON.parse(
    await readFile(new URL("inventory.stock.received.v1.json", eventDirectory), "utf8"),
  );
  const valid = validateJsonSchema(
    {
      stockItemId: "00000000-0000-4000-8000-000000000001",
      productId: "00000000-0000-4000-8000-000000000002",
      quantity: "1",
      unit: "piece",
      occurredAt: "2026-01-01T00:00:00.000Z",
    },
    schema,
  );
  assert.equal(valid.valid, true);
  const invalid = validateJsonSchema({ stockItemId: "stock-1", unexpected: true }, schema);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.message.includes("Unknown field")));
});

test("job validator supports lifecycle fixtures and rejects malformed consumers", async () => {
  const schema = JSON.parse(await readFile(new URL("job.v1.json", jobDirectory), "utf8"));
  const validJob = {
    jobId: "00000000-0000-4000-8000-000000000001",
    capability: "privacy.export",
    status: "PENDING",
    attempt: 0,
    traceId: "0123456789abcdef",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  assert.equal(validateJobEnvelope(validJob).valid, true);
  assert.equal(validateJsonSchema(validJob, schema).valid, true);
  assert.equal(validateJobEnvelope({ ...validJob, status: "BROKEN" }).valid, false);
  assert.equal(validateJobEnvelope({ ...validJob, unexpected: true }).valid, true);
  assert.equal(validateJsonSchema({ ...validJob, unexpected: true }, schema).valid, false);
});

test("privacy operations use operation-specific request and response contracts", async () => {
  const openApi = await readFile(openApiDocument, "utf8");
  const privacyExport = sectionForPath(openApi, "/privacy/export");
  const privacyErasure = sectionForPath(openApi, "/privacy/erasure");
  const privacyConsents = sectionForPath(openApi, "/privacy/consents");
  const privacyConsent = sectionForPath(openApi, "/privacy/consents/{purpose}");

  assert.match(privacyExport, /PrivacyExportRequest/);
  assert.match(privacyErasure, /PrivacyErasureRequest/);
  assert.match(privacyConsents, /PrivacyConsents/);
  assert.match(privacyConsent, /PrivacyConsentRequest/);
  assert.doesNotMatch(privacyConsent, /GenericRequest/);
});

test("public OpenAPI paths do not reference generic request or success contracts", async () => {
  const openApi = await readFile(openApiDocument, "utf8");
  const pathsSection = openApi.slice(openApi.indexOf("paths:"), openApi.indexOf("components:"));

  assert.doesNotMatch(pathsSection, /GenericRequest|GenericSuccess/);
});

function sectionForPath(document, path) {
  const start = document.indexOf(`  ${path}:`);
  assert.notEqual(start, -1, `OpenAPI path is missing: ${path}`);
  const next = document.indexOf("\n  /", start + 1);
  return document.slice(start, next === -1 ? document.length : next);
}
