import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresClient } from "../src/db/postgres-client.js";
import { PostgresCatalogRepository, PostgresCatalogLookupRepository, PostgresCatalogCandidateRepository } from "../src/catalog/postgres.js";
import { CatalogService, CatalogVersionConflictError, type Product } from "../src/catalog/service.js";
import { CatalogWorkflowService } from "../src/catalog/workflow.js";

const databaseUrl = process.env.CATALOG_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "CATALOG_TEST_DATABASE_URL is required. Catalog integration tests intentionally use real PostgreSQL.",
  );
}

const db = PostgresClient.create({ connectionString: databaseUrl });
const repository = new PostgresCatalogRepository(db);
const lookupRepository = new PostgresCatalogLookupRepository(db);
const candidateRepository = new PostgresCatalogCandidateRepository(db);

const actorId = randomUUID();
const traceId = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
const productId = randomUUID();

let service: CatalogService;

before(async () => {
  assert.equal(await db.ping(), true);
  let ids = 0;
  service = new CatalogService(
    repository,
    { next: () => (ids++ === 0 ? productId : randomUUID()) },
    { now: () => new Date("2026-10-02T00:00:00.000Z") },
  );
});

after(async () => {
  await db.query("DELETE FROM product_identifiers WHERE product_id=$1", [productId]);
  await db.query("DELETE FROM data_provenance WHERE entity_id=$1", [productId]);
  await db.query("DELETE FROM outbox_events WHERE aggregate_id=$1", [productId]);
  await db.query("DELETE FROM products WHERE id=$1", [productId]);
  await db.close();
});

describe("service-catalog / real PostgreSQL flow", () => {
  it("creates a manual product atomically and persists its barcode/provenance/event", async () => {
    const created = await service.createManualProduct({
      canonicalName: "Integration Latte",
      brand: "Integration Brand",
      defaultUnit: "l",
      category: "eggs-dairy",
      calories: 62,
      protein: 3.2,
      carbs: 4.8,
      fat: 3.5,
      fiber: 0,
      barcodes: ["8001234567890"],
      actorId,
      traceId,
    });

    assert.equal(created.id, productId);
    assert.equal(created.provenanceQuality, "VERIFIED");

    const row = await db.query(
      "SELECT p.id,p.canonical_name,p.version,pi.normalized_value,dp.source_version,oe.event_type " +
      "FROM products p " +
      "LEFT JOIN product_identifiers pi ON pi.product_id=p.id " +
      "LEFT JOIN data_provenance dp ON dp.entity_id=p.id " +
      "LEFT JOIN outbox_events oe ON oe.aggregate_id=p.id " +
      "WHERE p.id=$1",
      [productId],
    );

    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].canonical_name, "Integration Latte");
    assert.equal(Number(row.rows[0].version), 1);
    assert.equal(row.rows[0].normalized_value, "8001234567890");
    assert.equal(row.rows[0].source_version, "manual-v1");
    assert.equal(row.rows[0].event_type, "ProductCreated");
  });

  it("reads the product back through the real repository mapping", async () => {
    const read = await repository.getById(productId);
    assert.ok(read);
    assert.equal(read.id, productId);
    assert.equal(read.canonicalName, "Integration Latte");
    assert.deepEqual(read.barcodes, ["8001234567890"]);
    assert.equal(read.calories, 62);
    assert.equal(read.defaultUnit, "l");
  });

  it("persists a real provider barcode match and records a null system actor in the outbox", async () => {
    const barcode = `890${String(Date.now()).slice(-10)}`;
    const workflow = new CatalogWorkflowService(
      lookupRepository,
      candidateRepository,
      {
        lookup: async () => ({
          canonicalName: "Integration Imported Product",
          brand: "Integration Provider Brand",
          defaultUnit: "piece",
          quantityValue: 90,
          quantityUnit: "g",
          quantityLabel: "90 g",
          servingSize: "3 g",
          servingQuantity: 3,
          servingUnit: "g",
          images: { front: "https://example.test/front.jpg" },
          openFoodFacts: { code: barcode, product_name: "Integration Imported Product" },
          source: "openfoodfacts",
          sourceVersion: "off-api-v3",
          sourceRef: barcode,
          confidence: 0.85,
        }),
      },
    );

    const result = await workflow.resolveBarcode("BARCODE", barcode, traceId);
    assert.equal(result.status, "MATCHED");
    assert.equal(result.resolution, "provider");
    assert.ok(result.product);
    assert.equal(result.product?.barcodes.includes(barcode), true);

    const row = await db.query(
      "SELECT p.id,p.external_source,p.external_ref,p.quantity_value,p.quantity_unit,p.quantity_label,p.serving_size,p.serving_quantity,p.serving_unit,oe.actor_id " +
      "FROM products p " +
      "JOIN product_identifiers pi ON pi.product_id=p.id " +
      "JOIN outbox_events oe ON oe.aggregate_id=p.id " +
      "WHERE pi.normalized_value=$1",
      [barcode],
    );

    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].external_source, "openfoodfacts");
    assert.equal(row.rows[0].external_ref, barcode);
    assert.equal(Number(row.rows[0].quantity_value), 90);
    assert.equal(row.rows[0].quantity_unit, "g");
    assert.equal(row.rows[0].quantity_label, "90 g");
    assert.equal(row.rows[0].serving_size, "3 g");
    assert.equal(Number(row.rows[0].serving_quantity), 3);
    assert.equal(row.rows[0].serving_unit, "g");
    assert.equal(row.rows[0].actor_id, null);

    await db.query("DELETE FROM product_identifiers WHERE normalized_value=$1", [barcode]);
    await db.query("DELETE FROM outbox_events WHERE aggregate_id=$1", [row.rows[0].id]);
    await db.query("DELETE FROM data_provenance WHERE entity_id=$1", [row.rows[0].id]);
    await db.query("DELETE FROM products WHERE id=$1", [row.rows[0].id]);
  });

  it("resolves a barcode from the real local Catalog without a provider", async () => {
    const workflow = new CatalogWorkflowService(
      lookupRepository,
      candidateRepository,
    );

    const result = await workflow.resolveBarcode("BARCODE", "8001234567890", traceId);
    assert.equal(result.status, "MATCHED");
    assert.equal(result.resolution, "cache");
    assert.equal(result.product?.id, productId);
  });

  it("updates the real product with optimistic locking and changes the version", async () => {
    const updated = await service.updateProduct(
      productId,
      1,
      { name: "Integration Latte Updated", category: "eggs-dairy" },
      actorId,
      traceId,
    );

    assert.ok(updated);
    assert.equal(updated.canonicalName, "Integration Latte Updated");
    assert.equal(updated.version, 2);

    await assert.rejects(
      () => service.updateProduct(
        productId,
        1,
        { name: "Should Not Apply" },
        actorId,
        traceId,
      ),
      (error: unknown) => error instanceof CatalogVersionConflictError,
    );
    const actual = await repository.getById(productId);
    assert.ok(actual);
    assert.equal(actual.canonicalName, "Integration Latte Updated");
  });

  it("persists an imported candidate in the real Catalog owner database", async () => {
    const candidate = await candidateRepository.applyImportedCandidate({
      candidate: {
        productId: undefined,
        canonicalName: "Imported Product",
        brand: "Provider Brand",
        defaultUnit: "piece",
        confidence: 0.91,
        source: "openfoodfacts",
        requiresReview: true,
      },
      actorId,
      traceId,
    });

    assert.ok(candidate.productId);
    const row = await db.query(
      "SELECT p.provenance_quality,dp.source_version FROM products p " +
      "JOIN data_provenance dp ON dp.entity_id=p.id WHERE p.id=$1",
      [candidate.productId],
    );
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].provenance_quality, "IMPORTED");
    assert.equal(row.rows[0].source_version, "openfoodfacts");

    await db.query("DELETE FROM data_provenance WHERE entity_id=$1", [candidate.productId]);
    await db.query("DELETE FROM products WHERE id=$1", [candidate.productId]);
  });

  it("rolls back the entire manual-product transaction when the product insert violates a database constraint", async () => {
    const duplicateId = randomUUID();
    await assert.rejects(
      () =>
        repository.createManualProductAtomic({
          product: {
            id: duplicateId,
            canonicalName: "",
            brand: undefined,
            defaultUnit: "invalid" as Product["defaultUnit"],
            status: "ACTIVE",
            provenanceQuality: "VERIFIED",
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            barcodes: [],
          },
          provenance: {
            productId: duplicateId,
            source: "MANUAL",
            confidence: 1,
            observedAt: new Date(),
            sourceVersion: "manual-v1",
          },
          event: {
            eventId: randomUUID(),
            eventType: "ProductCreated",
            eventVersion: 1,
            aggregateType: "product",
            aggregateId: duplicateId,
            actorId,
            traceId,
            payload: {},
          },
        }),
    );

    const product = await db.query("SELECT id FROM products WHERE id=$1", [duplicateId]);
    const provenance = await db.query("SELECT id FROM data_provenance WHERE entity_id=$1", [duplicateId]);
    const events = await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1", [duplicateId]);

    assert.equal(product.rows.length, 0);
    assert.equal(provenance.rows.length, 0);
    assert.equal(events.rows.length, 0);
  });
});
