import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CatalogService, CatalogValidationError, normalizeIdentifier, resolveImportedField, type CatalogRepository, type Product } from "../src/catalog/service.js";
import { CatalogWorkflowService, type CatalogLookupRepository, type ExternalBarcodeLookupClient, type ProductCandidate } from "../src/catalog/workflow.js";
import { CatalogController, CatalogHttpError, toCatalogHttpError } from "../src/catalog/controller.js";
import {
  parseCreateProductBody,
  parsePatchProductBody,
  parseResolveBarcodeBody,
} from "../src/http/validators.js";
import { OidcTokenVerifier } from "../src/identity/oidc.js";

const meta = { requestId: "request-123456789", traceId: "trace-1234567890", schemaVersion: "1.0" as const };
const principal = {
  subject: "user-1",
  issuer: "issuer",
  audience: ["aud"],
  expiresAt: new Date(Date.now() + 60_000),
  issuedAt: new Date(),
  roles: [],
  scopes: [],
};

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    canonicalName: "Latte intero",
    brand: "Marca",
    defaultUnit: "l",
    status: "ACTIVE",
    provenanceQuality: "VERIFIED",
    version: 1,
    category: "eggs-dairy",
    calories: 62,
    protein: 3.2,
    carbs: 4.8,
    fat: 3.5,
    fiber: 0,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    barcodes: ["8001234567890"],
    ...overrides,
  };
}

class MemoryCatalogRepository implements CatalogRepository {
  public created: Product[] = [];
  public updated: Product[] = [];
  public existing: Product | undefined;

  public async listActive(): Promise<Product[]> { return this.created; }
  public async getById(): Promise<Product | undefined> { return this.existing; }

  public async createManualProductAtomic(input: { product: Product }): Promise<Product> {
    this.created.push(input.product);
    return input.product;
  }

  public async updateProductAtomic(input: {
    productId: string;
    expectedVersion: number;
    patch: { name?: string; brand?: string | null; category?: string | null; imageObjectKey?: string | null; nutrition?: Record<string, unknown> | null };
  }): Promise<Product | undefined> {
    if (!this.existing || this.existing.id !== input.productId) return undefined;
    if (this.existing.version !== input.expectedVersion) throw new Error("unexpected version");
    const updated = product({
      ...this.existing,
      canonicalName: input.patch.name ?? this.existing.canonicalName,
      version: this.existing.version + 1,
      updatedAt: new Date(),
    });
    this.updated.push(updated);
    this.existing = updated;
    return updated;
  }

  public async refreshExternalMatch(
    _input: Parameters<CatalogLookupRepository["refreshExternalMatch"]>[0],
  ): Promise<Product> {
    if (!this.existing) throw new Error("no existing product");
    return this.existing;
  }
}

describe("service-catalog / OIDC bootstrap", () => {
  it("uses the explicit internal JWKS URL without performing discovery", async () => {
    let discoveryCalls = 0;
    const verifier = await OidcTokenVerifier.fromIssuer(
      "https://192.168.1.24:8443/realms/dispensa",
      "account",
      async () => {
        discoveryCalls += 1;
        throw new Error("discovery must not be called");
      },
      {
        jwksUrl: "http://keycloak:8080/realms/dispensa/protocol/openid-connect/certs",
      },
    );

    assert.ok(verifier);
    assert.equal(discoveryCalls, 0);
  });
});

describe("service-catalog / pure catalog rules", () => {
  it("normalizes supported barcodes and preserves digits", () => {
    assert.equal(normalizeIdentifier("BARCODE", " 800-1234-567890 "), "8001234567890");
    assert.equal(normalizeIdentifier("EAN13", "8001234567890"), "8001234567890");
  });

  it("rejects unsupported barcode lengths and non-numeric values", () => {
    assert.throws(() => normalizeIdentifier("BARCODE", "123"), CatalogValidationError);
    assert.throws(() => normalizeIdentifier("BARCODE", "800123456789O"), CatalogValidationError);
  });

  it("normalizes SKU identifiers independently from barcode rules", () => {
    assert.equal(normalizeIdentifier("SKU", " abc-123 "), "ABC-123");
    assert.throws(() => normalizeIdentifier("SKU", " "), CatalogValidationError);
  });

  it("prefers manual values when resolving imported fields", () => {
    assert.equal(resolveImportedField("manual", "provider"), "manual");
    assert.equal(resolveImportedField(undefined, "provider"), "provider");
  });

  it("creates a canonical manual product and provenance event input", async () => {
    const repo = new MemoryCatalogRepository();
    const ids = {
      next: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    };
    const clock = { now: () => new Date("2026-10-02T00:00:00Z") };
    const service = new CatalogService(repo, ids, clock);

    const created = await service.createManualProduct({
      canonicalName: "  Latte intero ",
      brand: " Marca ",
      defaultUnit: "l",
      barcodes: ["8001234567890", "8001234567890"],
      actorId: "user-1",
      traceId: "trace-1234567890",
    });

    assert.equal(created.id, "id-1");
    assert.equal(created.canonicalName, "Latte intero");
    assert.equal(created.brand, "Marca");
    assert.deepEqual(created.barcodes, ["8001234567890"]);
    assert.equal(created.provenanceQuality, "VERIFIED");
    assert.equal(created.version, 1);
  });

  it("rejects an invalid manual-product command before persistence", async () => {
    const repo = new MemoryCatalogRepository();
    const service = new CatalogService(repo, { next: () => "id" }, { now: () => new Date() });
    await assert.rejects(
      () => service.createManualProduct({
        canonicalName: "",
        defaultUnit: "piece",
        actorId: "",
        traceId: "short",
      }),
      CatalogValidationError,
    );
    assert.equal(repo.created.length, 0);
  });

  it("maps a missing update product to undefined", async () => {
    const repo = new MemoryCatalogRepository();
    const service = new CatalogService(repo, { next: () => "id" }, { now: () => new Date() });
    const result = await service.updateProduct(
      "missing",
      1,
      { name: "New name" },
      "user-1",
      "trace-1234567890",
    );
    assert.equal(result, undefined);
  });
});

describe("service-catalog / rich barcode public contract", () => {
  it("keeps rich external product data available through the controller", async () => {
    const richProduct = product({
      quantityValue: 1,
      quantityUnit: "l",
      quantityLabel: "1 L",
      servingSize: "100 ml",
      servingQuantity: 100,
      servingUnit: "ml",
      images: { front: "https://example.test/front.jpg", ingredients: "https://example.test/ingredients.jpg" },
      openFoodFacts: {
        code: "8001234567890",
        product_name: "Latte intero",
        ingredients_text: "Milk",
        allergens_tags: ["en:milk"],
        nutriments: { "energy-kcal_100g": 62, proteins_100g: 3.2 },
      },
    });
    const lookup = {
      findByIdentifier: async () => richProduct,
      persistExternalMatch: async () => richProduct, refreshExternalMatch: async () => richProduct,
    };
    const workflow = new CatalogWorkflowService(
      lookup,
      { applyImportedCandidate: async (input) => input.candidate },
    );
    const repo = new MemoryCatalogRepository();
    repo.existing = richProduct;
    const catalog = new CatalogService(repo, { next: () => "id" }, { now: () => new Date("2026-10-02T00:00:00Z") });
    const controller = new CatalogController(catalog, workflow);

    const response = await controller.lookupBarcode("BARCODE", "8001234567890", meta);
    assert.equal(response.data.product.name, "Latte intero");
    assert.equal(response.data.product.package.value, 1);
    assert.equal(response.data.product.package.unit, "l");
    assert.equal(response.data.product.serving.size, "100 ml");
    assert.equal(response.data.product.serving.quantity, 100);
    assert.equal(response.data.product.serving.unit, "ml");
    assert.equal(response.data.product.images.front, "https://example.test/front.jpg");
    assert.equal(response.data.product.openFoodFacts?.ingredients_text, "Milk");
    assert.deepEqual(response.data.product.openFoodFacts?.allergens_tags, ["en:milk"]);
    assert.deepEqual(response.data.product.openFoodFacts?.nutriments, { "energy-kcal_100g": 62, proteins_100g: 3.2 });
  });
});

describe("service-catalog / ranked product search", () => {
  it("returns ranked external search hits through the workflow", async () => {
    const workflow = new CatalogWorkflowService(
      { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
      { applyImportedCandidate: async (input) => input.candidate },
      undefined,
      {
        search: async ({ query, limit, traceId }) => {
          assert.equal(query, "golia");
          assert.equal(limit, 8);
          assert.equal(traceId, meta.traceId);
          return [{
            code: "8001234567890",
            canonicalName: "Golia Caramella",
            brand: "Perfetti",
            category: "confectionery-candy",
            quantityLabel: "50 g",
            popularityKey: 123,
            completeness: 0.96,
          }];
        },
      },
    );

    const hits = await workflow.searchProducts("  golia  ", meta.traceId, 8);
    assert.equal(hits?.length, 1);
    assert.equal(hits?.[0]?.canonicalName, "Golia Caramella");
  });

  it("preserves provider unavailability instead of converting it to an empty result", async () => {
    const workflow = new CatalogWorkflowService(
      { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
      { applyImportedCandidate: async (input) => input.candidate },
      undefined,
      { search: async () => undefined },
    );

    assert.equal(await workflow.searchProducts("golia", meta.traceId, 8), undefined);
  });

  it("maps ranked search hits to the public controller DTO", async () => {
    const workflow = new CatalogWorkflowService(
      { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
      { applyImportedCandidate: async (input) => input.candidate },
      undefined,
      {
        search: async () => [{
          code: "8001234567890",
          canonicalName: "Golia Caramella",
          brand: "Perfetti",
          category: "confectionery-candy",
          photoUrl: "https://example.test/golia.jpg",
          quantityLabel: "50 g",
          calories: 410,
          protein: 0,
          carbs: 96,
          fat: 0,
          fiber: 0,
          popularityKey: 123,
          completeness: 0.96,
        }],
      },
    );
    const controller = new CatalogController(
      new CatalogService(new MemoryCatalogRepository(), { next: () => "p-1" }, { now: () => new Date() }),
      workflow,
    );

    const response = await controller.searchProducts(principal, "golia", 8, meta);
    assert.equal(response.data.items.length, 1);
    assert.deepEqual(response.data.items[0], {
      code: "8001234567890",
      name: "Golia Caramella",
      brand: "Perfetti",
      category: "confectionery-candy",
      imageUrl: "https://example.test/golia.jpg",
      packageLabel: "50 g",
      nutrition: {
        kcalPer100g: 410,
        proteinGPer100g: 0,
        carbsGPer100g: 96,
        fatGPer100g: 0,
        fiberGPer100g: 0,
      },
      popularityKey: 123,
      completeness: 0.96,
    });
  });

  it("returns a typed 503 error when the external search is unavailable", async () => {
    const workflow = new CatalogWorkflowService(
      { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
      { applyImportedCandidate: async (input) => input.candidate },
      undefined,
      { search: async () => undefined },
    );
    const controller = new CatalogController(
      new CatalogService(new MemoryCatalogRepository(), { next: () => "p-1" }, { now: () => new Date() }),
      workflow,
    );

    await assert.rejects(
      () => controller.searchProducts(principal, "golia", 8, meta),
      (error: unknown) => error instanceof CatalogHttpError && error.status === 503 && error.code === "UPSTREAM_ERROR",
    );
  });
});

describe("service-catalog / barcode workflow", () => {
  it("uses the local catalog first and does not call the external boundary for a complete manual product", async () => {
    let externalCalls = 0;
    const lookup: CatalogLookupRepository = {
      findByIdentifier: async () => product(),
      persistExternalMatch: async () => product(), refreshExternalMatch: async () => product(),
    };
    const external: ExternalBarcodeLookupClient = {
      lookup: async () => {
        externalCalls += 1;
        return undefined;
      },
    };
    const workflow = new CatalogWorkflowService(lookup, {
      applyImportedCandidate: async (input) => input.candidate,
    }, external);

    const result = await workflow.resolveBarcode("BARCODE", "8001234567890", "trace-1234567890");
    assert.equal(result.status, "MATCHED");
    assert.equal(result.resolution, "cache");
    assert.equal(externalCalls, 0);
  });

  it("reconciles a stale OpenFoodFacts catalog projection through off-lookup", async () => {
    const stale = product({
      provenanceQuality: "IMPORTED",
      externalSource: "openfoodfacts",
      externalRef: "8003440120156",
      calories: 240,
      protein: 0,
      carbs: 45.2,
      fat: 0.2,
      fiber: 0,
      quantityValue: 1,
      quantityUnit: "g",
      quantityLabel: "1 g",
      images: { front: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg" },
      openFoodFacts: {
        code: "8003440120156",
        product_name: "Golia",
        quantity: "90 g",
        product_quantity: 90,
        product_quantity_unit: "g",
        nutriments: { "energy-kcal_100g": 240 },
      },
    });
    const refreshed = product({
      ...stale,
      category: "confectionery-candy",
      calories: 240,
      protein: 0,
      carbs: 45.2,
      fat: 0.2,
      fiber: 0,
      quantityValue: 90,
      quantityUnit: "g",
      quantityLabel: "90 g",
      images: { front: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg" },
      version: 2,
    });
    let externalCalls = 0;
    let refreshCalls = 0;

    const lookup: CatalogLookupRepository = {
      findByIdentifier: async () => stale,
      persistExternalMatch: async () => refreshed,
      refreshExternalMatch: async () => {
        refreshCalls += 1;
        return refreshed;
      },
    };
    const external: ExternalBarcodeLookupClient = {
      lookup: async () => {
        externalCalls += 1;
        return {
          canonicalName: "Golia",
          brand: "Golia",
          defaultUnit: "g",
          category: "confectionery-candy",
          calories: 240,
          protein: 0,
          carbs: 45.2,
          fat: 0.2,
          images: { front: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg" },
          openFoodFacts: { code: "8003440120156" },
          source: "openfoodfacts",
          sourceVersion: "off-canonical-v1-cache",
          sourceRef: "8003440120156",
          confidence: 0.85,
        };
      },
    };

    const workflow = new CatalogWorkflowService(
      lookup,
      { applyImportedCandidate: async (input) => input.candidate },
      external,
    );

    const result = await workflow.resolveBarcode("BARCODE", "8003440120156", "trace-1234567890");
    assert.equal(result.status, "MATCHED");
    assert.equal(result.resolution, "cache");
    assert.equal(result.product?.canonicalName, "Golia");
    assert.equal(result.product?.category, "confectionery-candy");
    assert.equal(result.product?.calories, 240);
    assert.equal(result.product?.images?.front, "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg");
    assert.equal(externalCalls, 1);
    assert.equal(refreshCalls, 1);
  });

  it("persists a provider match on a real cache miss path", async () => {
    let persisted = 0;
    const externalProduct = {
      canonicalName: "Yogurt",
      defaultUnit: "piece" as const,
      source: "openfoodfacts",
      sourceVersion: "off-api-v3",
      confidence: 0.85,
    };
    const workflow = new CatalogWorkflowService(
      {
        findByIdentifier: async () => undefined,
        persistExternalMatch: async () => {
          persisted += 1;
          return product({ canonicalName: externalProduct.canonicalName, defaultUnit: externalProduct.defaultUnit, provenanceQuality: "IMPORTED" });
        },
        refreshExternalMatch: async () => product(),
      },
      { applyImportedCandidate: async (input) => input.candidate },
      { lookup: async () => externalProduct },
    );

    const result = await workflow.resolveBarcode("BARCODE", "8001234567890", "trace-1234567890");
    assert.equal(result.status, "MATCHED");
    assert.equal(result.resolution, "provider");
    assert.equal(result.product?.provenanceQuality, "IMPORTED");
    assert.equal(persisted, 1);
  });

  it("degrades rather than throwing when the external boundary fails", async () => {
    const workflow = new CatalogWorkflowService(
      { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
      { applyImportedCandidate: async (input) => input.candidate },
      { lookup: async () => { throw new Error("network"); } },
    );

    const result = await workflow.resolveBarcode("BARCODE", "8001234567890", "trace-1234567890");
    assert.equal(result.status, "DEGRADED");
    assert.equal(result.product, undefined);
  });

  it("requires review below the documented confidence threshold", async () => {
    const candidates: ProductCandidate[] = [];
    const workflow = new CatalogWorkflowService(
      { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
      { applyImportedCandidate: async (input) => {
        candidates.push(input.candidate);
        return input.candidate;
      } },
    );

    await workflow.submitImportedCandidate({
      canonicalName: "High confidence",
      defaultUnit: "piece",
      confidence: 0.96,
      source: "openfoodfacts",
      productId: undefined,
      brand: undefined,
    }, "user-1", "trace-1234567890");

    await workflow.submitImportedCandidate({
      canonicalName: "Review me",
      defaultUnit: "piece",
      confidence: 0.94,
      source: "openfoodfacts",
      productId: undefined,
      brand: undefined,
    }, "user-1", "trace-1234567890");

    assert.equal(candidates[0].requiresReview, false);
    assert.equal(candidates[1].requiresReview, true);
  });
});

describe("service-catalog / HTTP mapping and validators", () => {
  it("validates manual product bodies and applies the piece default", () => {
    assert.deepEqual(parseCreateProductBody({ name: " Latte " }), {
      canonicalName: "Latte",
      defaultUnit: "piece",
    });
  });

  it("rejects invalid barcodes before reaching the service", () => {
    assert.equal(parseCreateProductBody({ name: "Latte", barcodes: ["123"] }), undefined);
  });

  it("requires at least one patch field and rejects unknown fields", () => {
    assert.equal(parsePatchProductBody({}), undefined);
    assert.equal(parsePatchProductBody({ nope: true }), undefined);
    assert.deepEqual(parsePatchProductBody({ name: " New " }), { name: "New" });
  });

  it("parses barcode resolution only for digit strings", () => {
    assert.deepEqual(parseResolveBarcodeBody({ barcode: "00123456" }), {
      identifierType: "BARCODE",
      value: "00123456",
    });
    assert.equal(parseResolveBarcodeBody({ barcode: "12-34" }), undefined);
  });

  it("maps controller authentication, validation, not-found and internal errors deterministically", () => {
    const unauthenticated = toCatalogHttpError(
      new CatalogHttpError(401, "UNAUTHENTICATED", "Authentication is required."),
      meta,
    );
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error.code, "UNAUTHENTICATED");

    const validation = toCatalogHttpError(
      new CatalogValidationError(["bad"]),
      meta,
    );
    assert.equal(validation.status, 422);

    const internal = toCatalogHttpError(new Error("boom"), meta);
    assert.equal(internal.status, 500);
  });

  it("keeps the controller thin and delegates product creation to the service", async () => {
    const repo = new MemoryCatalogRepository();
    const service = new CatalogService(repo, { next: () => "p-1" }, { now: () => new Date("2026-10-02T00:00:00Z") });
    const workflow = new CatalogWorkflowService(
      { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
      { applyImportedCandidate: async (input) => input.candidate },
    );
    const controller = new CatalogController(service, workflow);

    const created = await controller.createProduct(principal, {
      canonicalName: "Latte",
      defaultUnit: "piece",
      traceId: meta.traceId,
    }, meta);

    assert.equal(created.data.productId, "p-1");
    assert.equal(created.data.name, "Latte");
  });

  it("rejects controller calls without a principal", async () => {
    const controller = new CatalogController(
      new CatalogService(new MemoryCatalogRepository(), { next: () => "p-1" }, { now: () => new Date() }),
      new CatalogWorkflowService(
        { findByIdentifier: async () => undefined, persistExternalMatch: async () => product(), refreshExternalMatch: async () => product() },
        { applyImportedCandidate: async (input) => input.candidate },
      ),
    );
    await assert.rejects(() => controller.createProduct(undefined, {
      canonicalName: "Latte",
      defaultUnit: "piece",
      traceId: meta.traceId,
    }, meta), (error: unknown) => error instanceof CatalogHttpError && error.status === 401);
  });
});


describe("service-catalog / barcode persistence error handling", () => {
  it("does not misclassify a Catalog persistence failure as provider degradation", async () => {
    const persistenceError = new Error("database write failed");
    const workflow = new CatalogWorkflowService(
      {
        findByIdentifier: async () => undefined,
        persistExternalMatch: async () => {
          throw persistenceError;
        },
        refreshExternalMatch: async () => product(),
      },
      { applyImportedCandidate: async (input) => input.candidate },
      {
        lookup: async () => ({
          canonicalName: "Yogurt",
          defaultUnit: "piece",
          source: "openfoodfacts",
          sourceVersion: "off-api-v3",
          confidence: 0.85,
        }),
      },
    );

    await assert.rejects(
      () => workflow.resolveBarcode("BARCODE", "8001234567890", meta.traceId),
      (error: unknown) => error === persistenceError,
    );

    const mapped = toCatalogHttpError(persistenceError, meta);
    assert.equal(mapped.status, 500);
    assert.equal(mapped.body.error.code, "INTERNAL_ERROR");
  });

  it("keeps provider failures on the documented degraded path", async () => {
    const workflow = new CatalogWorkflowService(
      {
        findByIdentifier: async () => undefined,
        persistExternalMatch: async () => product(), refreshExternalMatch: async () => product(),
      },
      { applyImportedCandidate: async (input) => input.candidate },
      {
        lookup: async () => {
          throw new Error("off-lookup unavailable");
        },
      },
    );

    const result = await workflow.resolveBarcode("BARCODE", "8001234567890", meta.traceId);
    assert.equal(result.status, "DEGRADED");
    assert.equal(result.product, undefined);
  });
});
