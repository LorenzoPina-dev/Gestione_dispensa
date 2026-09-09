import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateNutrition, rankRecipes } from "../dist/recipes-nutrition.js";

const recipes = [
  {
    id: "safe",
    title: "Safe pasta",
    source: "synthetic-recipes",
    quality: "VERIFIED",
    servings: 2,
    ingredients: [
      { name: "Pasta", allergens: ["gluten"] },
      { name: "Tomato", allergens: [] },
    ],
  },
  {
    id: "unsafe",
    title: "Milk pasta",
    source: "synthetic-recipes",
    quality: "VERIFIED",
    servings: 2,
    ingredients: [{ name: "Pasta", allergens: ["gluten", "milk"] }],
  },
];

test("recipe ranking excludes allergen violations and explains matches", () => {
  const ranked = rankRecipes(recipes, {
    availableIngredients: ["pasta", "tomato"],
    excludedAllergens: ["milk"],
  });

  assert.deepEqual(
    ranked.map((item) => item.recipe.id),
    ["safe"],
  );
  assert.deepEqual(ranked[0].matchedIngredients, ["Pasta", "Tomato"]);
  assert.deepEqual(ranked[0].missingIngredients, []);
  assert.deepEqual(ranked[0].reasonCodes, ["AVAILABLE_INGREDIENT"]);
});

test("nutrition scales servings and labels source quality", () => {
  const result = calculateNutrition(
    {
      productId: "product-1",
      source: "licensed-nutrition",
      sourceVersion: "v1",
      quality: "VERIFIED",
      servingQuantity: 100,
      servingUnit: "g",
      calories: 200,
      nutrients: { protein_g: 10 },
    },
    250,
  );

  assert.equal(result.confidenceLabel, "CONFIRMED");
  assert.equal(result.calories, 500);
  assert.equal(result.nutrients.protein_g, 25);
});

test("unknown nutrition never becomes a verified medical-style value", () => {
  const result = calculateNutrition(undefined, 1);

  assert.equal(result.confidenceLabel, "UNKNOWN");
  assert.equal(result.quality, "UNKNOWN");
  assert.equal(result.calories, 0);
});
