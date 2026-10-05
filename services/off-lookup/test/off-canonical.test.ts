import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeOffProduct } from "../src/off-canonical.js";

describe("OFF canonical normalizer", () => {
  it("reconstructs selected image URLs from dump metadata", () => {
    const product = normalizeOffProduct("8003440108888", {
      product_name_it: "Golia Activ Plus Senza Zucchero",
      brands: "Perfetti",
      quantity: "90 g",
      categories_tags: ["it:caramelle"],
      images: {
        front_it: { rev: "3", imgid: "1", sizes: { "100": {}, "200": {}, "400": {}, full: { w: 1000, h: 1000 } } },
        ingredients_it: { rev: "10", imgid: "2", sizes: { "100": {}, "200": {}, "400": {} } },
        nutrition_it: { rev: "5", imgid: "3", sizes: { "100": {}, "200": {}, "400": {} } },
        packaging_it: { rev: "14", imgid: "4", sizes: { "100": {}, "200": {}, "400": {} } },
      },
      ingredients_text_it: "Edulcoranti",
      packaging_text_it: "Plastica",
      nutriments: {
        "energy-kcal_100g": 230,
        "proteins_100g": 0,
        "carbohydrates_100g": 93,
        "fat_100g": 0,
      },
      nutriscore_grade: "b",
      nova_group: 4,
      ecoscore_grade: "b",
      ecoscore_score: 74,
    });

    assert.equal(product.name, "Golia Activ Plus Senza Zucchero");
    assert.equal(product.brand, "Perfetti");
    assert.equal(product.category, "confectionery-candy");
    assert.deepEqual(product.quantity, { value: 90, unit: "g", label: "90 g" });
    assert.equal((product.images as any).front.url, "https://images.openfoodfacts.org/images/products/800/344/010/8888/front_it.3.400.jpg");
    assert.equal((product.images as any).front.small, "https://images.openfoodfacts.org/images/products/800/344/010/8888/front_it.3.200.jpg");
    assert.equal((product.images as any).ingredients.url, "https://images.openfoodfacts.org/images/products/800/344/010/8888/ingredients_it.10.400.jpg");
    assert.equal(product.image_front_url, (product.images as any).front.url);
    assert.equal(product.image_front_small_url, (product.images as any).front.small);
    assert.equal((product.ingredients as any).text, "Edulcoranti");
    assert.equal((product.nutriScore as any).grade, "b");
    assert.equal((product.nova as any).group, 4);
    assert.equal((product.ecoScore as any).score, 74);
  });

  it("uses the same canonical shape for an API-shaped input", () => {
    const product = normalizeOffProduct("8003440108888", {
      name: "Golia",
      brand: "Perfetti",
      quantity: { value: 90, unit: "g", label: "90 g" },
      images: { front: { url: "https://example.test/front.jpg", small: "https://example.test/front-small.jpg", thumb: "https://example.test/front-thumb.jpg" } },
      nutrition: { "energy-kcal_100g": 230 },
      openFoodFacts: {
        product_name_it: "Golia",
        brands: "Perfetti",
        quantity: "90 g",
        image_front_url: "https://example.test/front.jpg",
        nutriments: { "energy-kcal_100g": 230 },
      },
    });

    assert.equal(product.name, "Golia");
    assert.equal((product.images as any).front.url, "https://example.test/front.jpg");
    assert.equal((product.openFoodFacts as any).product_name_it, "Golia");
  });
});
