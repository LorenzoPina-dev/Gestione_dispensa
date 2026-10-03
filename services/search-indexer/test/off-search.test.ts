import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OpenSearchOffIndex,
  normalizeSearchText,
  rankOffSearchHits,
  toOffSearchDocument,
  MIN_OFF_COMPLETENESS,
  type OffSearchHit,
} from "../src/off-search.js";

describe("OFF OpenSearch projection", () => {
  it("normalizes accents and punctuation consistently", () => {
    assert.equal(normalizeSearchText("  Caffè — Panna "), "caffe panna");
  });

  it("builds a compact searchable document", () => {
    const doc = toOffSearchDocument({
      code: "8001234567890",
      product: {
        product_name_it: "Latte Intero",
        brands: "Marca Test",
        categories_tags: ["en:dairies", "en:milks"],
        labels_tags: ["en:high-protein"],
        packaging_tags: ["en:carton"],
        ingredients_tags: ["en:milk"],
        quantity: "1 L",
        image_front_url: "https://example.test/front.jpg",
        nutriments: {
          "energy-kcal_100g": 62,
          proteins_100g: 3.2,
          carbohydrates_100g: 4.8,
          fat_100g: 3.5,
          fiber_100g: 0,
        },
        popularity_key: 42,
        completeness: 0.9,
      },
    });
    assert.equal(doc?.code, "8001234567890");
    assert.equal(doc?.nameExact, "latte intero");
    assert.equal(doc?.brand, "Marca Test");
    assert.equal(doc?.calories, 62);
    assert.equal(doc?.searchText.includes("Marca Test"), true);
    assert.equal(doc?.featureText.includes("en:high-protein"), true);
    assert.equal(doc?.featureText.includes("en:carton"), true);
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

  it("talks to OpenSearch through the documented REST surface", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = async (url: string | URL, init: RequestInit = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (init.method === "HEAD") return new Response(null, { status: 404 });
      if (value.endsWith("/off-products-v1") && init.method === "PUT") return new Response(null, { status: 200 });
      if (value.endsWith("/_search")) {
        return new Response(JSON.stringify({
          hits: {
            hits: [
              { _score: 4.2, _source: {
                code: "8001234567890",
                name: "Golia",
                brand: "Perfetti",
                category: "confectionery-candy",
                categoriesTags: ["en:candies"],
                quantityLabel: "40 g",
                imageUrl: null,
                productQuantity: 40,
                productQuantityUnit: "g",
                calories: 390,
                protein: 0,
                carbs: 95,
                fat: 0,
                fiber: 0,
                popularityKey: 100,
                completeness: 0.95,
              } },
            ],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 200 });
    };

    const index = new OpenSearchOffIndex("http://opensearch:9200", undefined, 1000, fakeFetch);
    const result = await index.search("golia", 8);
    assert.equal(result.status, "found");
    assert.equal(result.hits[0]?.code, "8001234567890");
    assert.equal(calls.some((call) => call.url.endsWith("/_search")), true);
    const searchCall = calls.find((call) => call.url.endsWith("/_search"));
    assert.match(String(searchCall?.init.body), /nameExact/);
    assert.match(String(searchCall?.init.body), /brandExact/);
    assert.match(String(searchCall?.init.body), /featureText/);
    assert.match(String(searchCall?.init.body), /completeness/);
  });

  it("does not index a product below the completeness threshold", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = async (url: string | URL, init: RequestInit = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (init.method === "HEAD") return new Response(null, { status: 404 });
      if (value.endsWith("/off-products-v1") && init.method === "PUT") {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 200 });
    };

    const index = new OpenSearchOffIndex("http://opensearch:9200", undefined, 1000, fakeFetch);
    const low = toOffSearchDocument({
      code: "8001234567890",
      product: {
        product_name: "Low quality",
        completeness: MIN_OFF_COMPLETENESS - 0.01,
      },
    });
    assert.ok(low);
    await index.upsert(low);
    assert.equal(calls.some((call) => call.url.includes("8001234567890")), false);
  });
});
