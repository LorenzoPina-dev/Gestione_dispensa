import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OpenSearchOffIndex,
  normalizeSearchText,
  rankOffSearchHits,
  toOffSearchDocument,
  MIN_OFF_COMPLETENESS,
  OFF_SEARCH_PROJECTION_VERSION,
  type OffSearchHit,
} from "../src/off-search.js";

describe("OFF OpenSearch projection", () => {
  it("normalizes accents and punctuation consistently", () => {
    assert.equal(normalizeSearchText("  Caffè — Panna "), "caffe panna");
  });

  it("builds the minimal searchable document from the canonical off-lookup shape", () => {
    const doc = toOffSearchDocument({
      code: "8003440120156",
      product: {
        code: "8003440120156",
        name: "Golia",
        brand: "Golia",
        category: "confectionery-candy",
        categories: ["en:snacks", "en:candies"],
        quantity: { value: 180, unit: "g", label: "180 g" },
        images: {
          front: {
            url: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg",
            small: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.200.jpg",
            thumb: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.100.jpg",
          },
          ingredients: {
            url: "https://images.openfoodfacts.org/images/products/800/344/012/0156/ingredients_fr.13.400.jpg",
          },
        },
        ingredients: { text: "Sugar, glucose syrup" },
        labels: ["en:no-gluten"],
        completeness: 0.95,
        popularity_key: 100,
      },
    });

    assert.ok(doc);
    assert.equal(doc.code, "8003440120156");
    assert.equal(doc.name, "Golia");
    assert.equal(doc.brand, "Golia");
    assert.equal(doc.category, "confectionery-candy");
    assert.deepEqual(doc.categoriesTags, ["en:snacks", "en:candies"]);
    assert.equal(doc.quantityLabel, "180 g");
    assert.equal(
      doc.imageUrl,
      "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg",
    );
    assert.equal(doc.featureText.includes("Sugar, glucose syrup"), true);
    assert.equal(doc.featureText.includes("en:no-gluten"), true);
    assert.equal(doc.popularityKey, 100);
    assert.equal(doc.completeness, 0.95);
    assert.equal("calories" in doc, false);
    assert.equal("protein" in doc, false);
    assert.equal("productQuantity" in doc, false);
  });

  it("uses exactly images.front.url and never replaces it with a smaller rendition", () => {
    const doc = toOffSearchDocument({
      code: "8003440120156",
      product: {
        name: "Golia",
        brand: "Golia",
        category: "confectionery-candy",
        images: {
          front: {
            url: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg",
            small: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.200.jpg",
            thumb: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.100.jpg",
          },
          packaging: { url: "https://example.test/packaging.jpg" },
          ingredients: { url: "https://example.test/ingredients.jpg" },
        },
        completeness: 0.9,
      },
    });
    assert.equal(
      doc?.imageUrl,
      "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg",
    );
  });

  it("does not fall back to non-front images when the canonical front image is absent", () => {
    const doc = toOffSearchDocument({
      code: "8003440120156",
      product: {
        name: "Golia",
        images: {
          ingredients: { url: "https://example.test/ingredients.jpg" },
          packaging: { url: "https://example.test/packaging.jpg" },
        },
        completeness: 0.9,
      },
    });
    assert.equal(doc?.imageUrl, null);
  });

  it("accepts the legacy raw source only as a compatibility input, without re-selecting images", () => {
    const doc = toOffSearchDocument({
      code: "3017620422003",
      product: {
        product_name: "Pasta",
        image_front_url: "https://example.test/front-400.jpg",
        image_front_small_url: "https://example.test/front-200.jpg",
        image_ingredients_url: "https://example.test/ingredients.jpg",
        categories_tags: ["en:pasta"],
        quantity: "500 g",
        completeness: 0.9,
      },
    });
    assert.equal(doc?.imageUrl, "https://example.test/front-400.jpg");
    assert.equal(doc?.quantityLabel, "500 g");
  });

  it("keeps exact and prefix matches ahead of weaker lexical matches", () => {
    const hits: OffSearchHit[] = [
      { code: "3", product: { product_name: "Golia gusto menta", completeness: 0.9 }, score: 8 },
      { code: "1", product: { product_name: "Golia", completeness: 0.8 }, score: 3 },
      { code: "2", product: { product_name: "Caramelle alla menta", completeness: 1 }, score: 20 },
    ];
    const ranked = rankOffSearchHits("golia", hits, 3);
    assert.equal(ranked[0]?.code, "1");
    assert.equal(ranked[1]?.code, "3");
  });

  it("ranks an exact brand match above a generic feature match", () => {
    const hits: OffSearchHit[] = [
      { code: "1", product: { product_name: "Pasta", brands: "Barilla", completeness: 0.9, featureText: "integrale" }, score: 2 },
      { code: "2", product: { product_name: "Pasta Integrale", brands: "Altra Marca", completeness: 1, featureText: "barilla" }, score: 20 },
    ];
    const ranked = rankOffSearchHits("barilla", hits, 2);
    assert.equal(ranked[0]?.code, "1");
  });

  it("creates the minimal OpenSearch mapping and requests the same minimal source fields", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = async (url: string | URL, init: RequestInit = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (init.method === "HEAD") return new Response(null, { status: 404 });
      if (value.endsWith("/off-products-v1") && init.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { mappings?: { properties?: Record<string, unknown> } };
        const props = body.mappings?.properties ?? {};
        assert.ok("imageUrl" in props);
        assert.ok("name" in props);
        assert.equal("calories" in props, false);
        assert.equal("productQuantity" in props, false);
        return new Response(null, { status: 200 });
      }
      if (value.endsWith("/_search")) {
        const body = JSON.parse(String(init.body)) as { _source?: string[] };
        assert.deepEqual(body._source, [
          "code", "name", "brand", "category", "categoriesTags", "quantityLabel", "featureText",
          "imageUrl", "popularityKey", "completeness",
        ]);
        return new Response(JSON.stringify({
          hits: {
            hits: [{
              _score: 2,
              _source: {
                code: "8003440120156",
                name: "Golia",
                brand: "Golia",
                category: "confectionery-candy",
                categoriesTags: ["en:candies"],
                quantityLabel: "180 g",
                featureText: "Golia Golia en:candies",
                imageUrl: "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg",
                popularityKey: 100,
                completeness: 0.95,
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 200 });
    };

    const index = new OpenSearchOffIndex("http://opensearch:9200", undefined, 1000, fakeFetch);
    const result = await index.search("golia", 8);
    assert.equal(OFF_SEARCH_PROJECTION_VERSION, 9);
    assert.equal(result.status, "found");
    assert.equal(result.hits[0]?.code, "8003440120156");
    assert.equal(
      result.hits[0]?.product.image_front_url,
      "https://images.openfoodfacts.org/images/products/800/344/012/0156/front_fr.3.400.jpg",
    );
    assert.equal(result.hits[0]?.product.image_front_small_url, undefined);
    assert.equal(result.hits[0]?.product.calories, undefined);
  });

  it("does not expose an invalid preview URL from OpenSearch", async () => {
    const fakeFetch = async (url: string | URL, init: RequestInit = {}) => {
      const value = String(url);
      if (init.method === "HEAD") return new Response(null, { status: 200 });
      if (value.endsWith("/_search")) {
        return new Response(JSON.stringify({
          hits: { hits: [{ _score: 2, _source: {
            code: "1901040901922",
            name: "Hing Goli",
            brand: "Test",
            imageUrl: "punchoneman",
            completeness: 0.9,
          } }] },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (value.endsWith("/_mapping")) return new Response(null, { status: 200 });
      return new Response(null, { status: 200 });
    };

    const index = new OpenSearchOffIndex("http://opensearch:9200", undefined, 1000, fakeFetch);
    const result = await index.search("hing goli", 8);
    assert.equal(result.hits[0]?.product.image_front_url, undefined);
  });

  it("does not index a product below the completeness threshold", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = async (url: string | URL, init: RequestInit = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (init.method === "HEAD") return new Response(null, { status: 404 });
      if (value.endsWith("/off-products-v1") && init.method === "PUT") return new Response(null, { status: 200 });
      return new Response(null, { status: 200 });
    };

    const index = new OpenSearchOffIndex("http://opensearch:9200", undefined, 1000, fakeFetch);
    const low = toOffSearchDocument({
      code: "8001234567890",
      product: { name: "Low quality", completeness: MIN_OFF_COMPLETENESS - 0.01 },
    });
    assert.ok(low);
    await index.upsert(low);
    assert.equal(calls.some((call) => call.url.includes("8001234567890")), false);
  });
});
