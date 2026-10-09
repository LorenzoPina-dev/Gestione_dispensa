import assert from "node:assert/strict";
import test from "node:test";
import { ProductLookupService } from "../src/product-lookup-service.js";
import type { OffApiClient } from "../src/off-api-client.js";
import type { ProductRepository, ProductDocument } from "../src/mongo-product-repository.js";

class FakeRepository implements ProductRepository {
  public refreshes = 0;
  constructor(private readonly product?: ProductDocument) {}
  async findByCode(): Promise<ProductDocument | undefined> { return this.product; }
  async upsertFromLiveApi(): Promise<void> { this.refreshes += 1; }
  async recordRefreshAttempt(): Promise<void> {}
  async isAvailable(): Promise<boolean> { return true; }
  async close(): Promise<void> {}
}

function apiThatMustNotBeCalled(): OffApiClient {
  return {
    async fetchProduct(): Promise<never> {
      throw new Error("remote API must not be called");
    },
    isCircuitOpen: () => false,
  };
}

test("local dump product is returned after deterministic derivation without API call", async () => {
  const repository = new FakeRepository({
    code: "7622210449283",
    product_name_it: "Biscotti",
    images: {
      selected: {
        front: {
          it: { imgid: "1", rev: "584" },
        },
      },
      uploaded: {
        "1": { uploaded_t: 1700000000 },
      },
    },
  });

  const service = new ProductLookupService(repository, apiThatMustNotBeCalled(), undefined, undefined, {
    remoteEnrichment: "missing",
    requiredLocalFields: ["name"],
  });

  const result = await service.lookup(" 7622210449283 ");
  assert.equal(result.outcome, "hit");
  if (result.outcome !== "hit") return;

  assert.equal(result.source, "cache");
  assert.equal(
    result.product.image_front_url,
    "https://images.openfoodfacts.org/images/products/762/221/044/9283/front_it.584.400.jpg",
  );
});

test("a missing configured required field triggers remote enrichment only after local derivation", async () => {
  let calls = 0;
  const repository = new FakeRepository({
    code: "1234567890123",
    product_name_it: "Prodotto",
    images: {},
  });

  const api: OffApiClient = {
    async fetchProduct() {
      calls += 1;
      return {
        status: "found",
        product: { code: "1234567890123", image_front_url: "https://example.invalid/front.jpg" },
      };
    },
    isCircuitOpen: () => false,
  };

  const service = new ProductLookupService(repository, api, undefined, undefined, {
    remoteEnrichment: "missing",
    requiredLocalFields: ["image"],
  });

  const result = await service.lookup("1234567890123");
  assert.equal(result.outcome, "hit");
  assert.equal(calls, 1);
});

test("a sparse local document is not rejected merely because completeness is absent", async () => {
  const repository = new FakeRepository({
    code: "0012345678905",
    product_name_it: "Prodotto minimo",
  });

  const service = new ProductLookupService(repository, apiThatMustNotBeCalled(), undefined, undefined, {
    remoteEnrichment: "never",
    requiredLocalFields: ["name"],
  });

  const result = await service.lookup("0012345678905");
  assert.equal(result.outcome, "hit");
});
