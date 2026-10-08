import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateMissingIngredients, unitInfo } from "../src/add-missing-domain.js";
import { mergeSourceIngredientQuantities } from "../src/recipe-discovery.js";

describe("service-recipes / add-missing pure domain", () => {
  it("converts mass and volume to common base units", () => {
    assert.deepEqual(unitInfo("kg"), { family: "mass", factor: 1000 });
    assert.deepEqual(unitInfo("g"), { family: "mass", factor: 1 });
    assert.deepEqual(unitInfo("l"), { family: "volume", factor: 1000 });
    assert.deepEqual(unitInfo("ml"), { family: "volume", factor: 1 });
    assert.equal(unitInfo("unknown"), null);
  });

  it("returns no deficit when inventory fully covers an ingredient", () => {
    const needs = calculateMissingIngredients(
      [{ productId: "p1", name: "Farina", quantity: 500, unit: "g" }],
      [{ productId: "p1", quantity: 1, unit: "kg" }],
    );
    assert.deepEqual(needs, []);
  });

  it("calculates mass deficits across compatible units", () => {
    const needs = calculateMissingIngredients(
      [{ productId: "p1", name: "Farina", quantity: 2, unit: "kg" }],
      [
        { productId: "p1", quantity: 500, unit: "g" },
        { productId: "p1", quantity: 1, unit: "kg" },
      ],
    );
    assert.equal(needs.length, 1);
    assert.equal(needs[0].quantity, 0.5);
  });

  it("does not mix mass and volume or unrelated products", () => {
    const needs = calculateMissingIngredients(
      [{ productId: "p1", name: "Latte", quantity: 2, unit: "l" }],
      [
        { productId: "p1", quantity: 500, unit: "g" },
        { productId: "p2", quantity: 5, unit: "l" },
      ],
    );
    assert.equal(needs.length, 1);
    assert.equal(needs[0].quantity, 2);
  });

  it("handles count units without conversion", () => {
    const needs = calculateMissingIngredients(
      [{ productId: "p1", name: "Uova", quantity: 6, unit: "piece" }],
      [{ productId: "p1", quantity: 4, unit: "piece"}],
    );
    assert.equal(needs[0].quantity, 2);
  });

  it("ignores unsupported or non-positive ingredients rather than inventing stock", () => {
    const needs = calculateMissingIngredients(
      [
        { productId: "p1", name: "Unknown", quantity: 2, unit: "box" },
        { productId: "p2", name: "Zero", quantity: 0, unit: "g" },
      ],
      [{ productId: "p1", quantity: 1, unit: "box" }],
    );
    assert.deepEqual(needs, []);
  });
});

describe("service-recipes / source ingredient quantity enrichment", () => {
  it("fills missing recipe quantities from source ingredient text", () => {
    const result = mergeSourceIngredientQuantities(
      [{
        name: "Eggs",
        displayName: "Eggs",
        canonicalIngredient: "uovo",
        quantity: null,
        quantityConfidence: 0,
      }],
      ["2 eggs, beaten"],
    );
    assert.equal(result[0].quantity, 2);
    assert.equal(result[0].unit, "piece");
    assert.equal(result[0].quantityConfidence, 0.82);
  });

  it("does not use substring matches for source ingredient enrichment", () => {
    const result = mergeSourceIngredientQuantities(
      [{
        name: "salt",
        displayName: "salt",
        canonicalIngredient: "sale",
        quantity: null,
        quantityConfidence: 0,
      }],
      ["salted butter 100 g"],
    );
    assert.equal(result[0].quantity, null);
  });
});
