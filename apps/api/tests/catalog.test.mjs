import assert from "node:assert/strict";
import { test } from "node:test";
import { FixedClock, SequenceIdGenerator } from "../../../packages/testkit/src/index.ts";
import {
  CatalogService,
  CatalogValidationError,
  normalizeIdentifier,
  resolveImportedField,
} from "../src/catalog/service.ts";

const command = (overrides = {}) => ({
  canonicalName: "  Pasta  ",
  brand: "Marca",
  defaultUnit: "pack",
  actorId: "user-1",
  traceId: "0123456789abcdef",
  ...overrides,
});

test("manual product creation confirms provenance and emits an update event atomically", async () => {
  const calls = [];
  const service = new CatalogService(
    {
      async createManualProductAtomic(input) {
        calls.push(input);
        return input.product;
      },
    },
    new SequenceIdGenerator(["product-1", "event-1"]),
    new FixedClock("2026-01-01T00:00:00Z"),
  );
  const product = await service.createManualProduct(command());

  assert.equal(calls.length, 1);
  assert.equal(product.canonicalName, "Pasta");
  assert.equal(product.provenanceQuality, "VERIFIED");
  assert.equal(calls[0].provenance.confidence, 1);
  assert.equal(calls[0].event.eventType, "catalog.product-updated");
});

test("manual product validation rejects invalid data before persistence", async () => {
  let writes = 0;
  const service = new CatalogService(
    {
      async createManualProductAtomic() {
        writes += 1;
        throw new Error("unexpected");
      },
    },
    new SequenceIdGenerator(["id"]),
    new FixedClock("2026-01-01T00:00:00Z"),
  );

  await assert.rejects(
    () => service.createManualProduct(command({ canonicalName: "", defaultUnit: "invalid" })),
    CatalogValidationError,
  );
  assert.equal(writes, 0);
});

test("identifier normalization is deterministic and imported values never override manual values", () => {
  assert.equal(normalizeIdentifier("EAN13", "80-1234567890-1"), "8012345678901");
  assert.equal(normalizeIdentifier("SKU", " sku-01 "), "SKU-01");
  assert.equal(resolveImportedField("manual", "imported"), "manual");
  assert.equal(resolveImportedField(undefined, "imported"), "imported");
  assert.throws(() => normalizeIdentifier("EAN13", "abc"), /barcode/);
});
