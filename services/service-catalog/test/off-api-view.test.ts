import assert from "node:assert/strict";
import test from "node:test";
import { toOffApiView } from "../src/catalog/off-api-view.js";

test("builds API-shaped OFF image URLs from selected metadata", () => {
  const result = toOffApiView("80737018", {
    code: "80737018",
    lc: "it",
    lang: "it",
    images: {
      selected: {
        front: {
          it: {
            rev: "29",
            imgid: "6",
            sizes: {
              "100": { h: 100, w: 68 },
              "200": { h: 200, w: 136 },
              "400": { h: 289, w: 196 },
              full: { h: 289, w: 196 },
            },
          },
        },
        nutrition: {
          it: {
            rev: "32",
            imgid: "7",
            sizes: {
              "100": { h: 49, w: 100 },
              "200": { h: 98, w: 200 },
              "400": { h: 196, w: 400 },
              full: { h: 588, w: 1200 },
            },
          },
        },
        ingredients: {
          it: {
            rev: 41,
            imgid: 8,
            sizes: {
              "100": { h: 100, w: 75 },
              "200": { h: 200, w: 150 },
              "400": { h: 400, w: 300 },
              full: { h: 4032, w: 3024 },
            },
          },
        },
      },
    },
  });

  assert.ok(result);
  assert.equal(
    result.images.image_front_url,
    "https://images.openfoodfacts.org/images/products/80737018/front_it.29.400.jpg",
  );
  assert.equal(
    result.images.image_front_small_url,
    "https://images.openfoodfacts.org/images/products/80737018/front_it.29.200.jpg",
  );
  assert.equal(
    result.images.image_front_thumb_url,
    "https://images.openfoodfacts.org/images/products/80737018/front_it.29.100.jpg",
  );
  assert.equal(
    result.images.image_nutrition_url,
    "https://images.openfoodfacts.org/images/products/80737018/nutrition_it.32.400.jpg",
  );
  assert.equal(
    result.images.image_ingredients_url,
    "https://images.openfoodfacts.org/images/products/80737018/ingredients_it.41.400.jpg",
  );
  assert.equal(result.product.image_front_url, result.images.image_front_url);
  assert.equal(result.product.image_front_small_url, result.images.image_front_small_url);
  assert.equal(result.product.image_front_thumb_url, result.images.image_front_thumb_url);
  assert.equal(result.product._cache_meta, undefined);
});

test("uses product split path for EAN-13 style codes", () => {
  const result = toOffApiView("5449000000996", {
    code: "5449000000996",
    images: {
      front_en: {
        rev: 12,
        imgid: 1,
        sizes: { "100": {}, "200": {}, "400": {}, full: {} },
      },
    },
  });
  assert.equal(
    result?.images.image_front_url,
    "https://images.openfoodfacts.org/images/products/544/900/000/0996/front_en.12.400.jpg",
  );
});
