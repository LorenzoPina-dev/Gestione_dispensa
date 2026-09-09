import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogWorkflowService } from "../dist/catalog/workflow.js";

const product = {
  id: "product-1",
  canonicalName: "Pasta",
  brand: "Marca",
  defaultUnit: "pack",
  status: "ACTIVE",
  provenanceQuality: "VERIFIED",
  version: 1,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

test("barcode workflow returns a normalized match for known identifiers", async () => {
  const service = new CatalogWorkflowService(
    {
      async findByIdentifier() {
        return product;
      },
    },
    {
      async applyImportedCandidate(input) {
        return input.candidate;
      },
    },
  );
  const result = await service.resolveBarcode("EAN13", "80-1234567890-1");

  assert.equal(result.status, "MATCHED");
  assert.equal(result.normalizedValue, "8012345678901");
  assert.equal(result.product.id, "product-1");
});

test("barcode workflow reports unknown identifiers without creating data", async () => {
  let writes = 0;
  const service = new CatalogWorkflowService(
    {
      async findByIdentifier() {
        return undefined;
      },
    },
    {
      async applyImportedCandidate(input) {
        writes += 1;
        return input.candidate;
      },
    },
  );
  const result = await service.resolveBarcode("EAN13", "8012345678901");

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.product, undefined);
  assert.equal(writes, 0);
});

test("imported candidates below confidence threshold require review", async () => {
  let submitted;
  const service = new CatalogWorkflowService(
    {
      async findByIdentifier() {
        return undefined;
      },
    },
    {
      async applyImportedCandidate(input) {
        submitted = input;
        return input.candidate;
      },
    },
  );
  const candidate = await service.submitImportedCandidate(
    {
      productId: undefined,
      canonicalName: "Pasta",
      brand: undefined,
      defaultUnit: "pack",
      confidence: 0.7,
      source: "provider-1",
    },
    "operator-1",
    "0123456789abcdef",
  );

  assert.equal(candidate.requiresReview, true);
  assert.equal(submitted.actorId, "operator-1");
});
