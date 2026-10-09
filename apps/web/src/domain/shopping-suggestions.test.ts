import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveOfferSuggestions,
  deriveRecipeSuggestions,
  deriveReorderSuggestions,
  isAlreadyListed,
  normalizeLabel,
} from "./shopping-suggestions.js";

test("labels compare without accents, case or punctuation", () => {
  assert.equal(normalizeLabel("  Caffè,  Moka! "), "caffe moka");
  assert.equal(isAlreadyListed([{ displayName: "Farina 00" }], { label: "farina  00" }), true);
  assert.equal(isAlreadyListed([{ displayName: "x", productId: "p1" }], { productId: "p1", label: "other" }), true);
  assert.equal(isAlreadyListed([{ displayName: "Latte" }], { label: "Olio" }), false);
});

test("reorder: rows of one product are summed and compared to the threshold", () => {
  const stock = [
    { id: "a", productId: "p1", name: "Farina 00", unit: "g", reorderPoint: 300, batches: [{ quantity: 100 }] },
    { id: "b", productId: "p1", name: "Farina 00", unit: "g", batches: [{ quantity: 50 }] },
    { id: "c", productId: "p2", name: "Pasta", unit: "g", reorderPoint: 200, batches: [{ quantity: 900 }] },
    { id: "d", name: "Sale", unit: "piece", batches: [{ quantity: 0 }] },
  ];
  const result = deriveReorderSuggestions(stock, []);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.label, "Farina 00");
  assert.equal(result[0]?.source, "REORDER");
  assert.equal(result[0]?.quantity, 200); // shortfall 150 g rounded up to the 100 g step
  assert.equal(result[0]?.unit, "g");
});

test("reorder: countables suggest at least one and skip what is already listed", () => {
  const stock = [{ id: "a", productId: "p1", name: "Uova", unit: "piece", reorderPoint: 2, batches: [{ quantity: 2 }] }];
  assert.equal(deriveReorderSuggestions(stock, [])[0]?.quantity, 1);
  assert.equal(deriveReorderSuggestions(stock, [{ displayName: "uova" }]).length, 0);
});

test("recipes: same ingredient from two recipes becomes one summed row", () => {
  const result = deriveRecipeSuggestions(
    [
      { recipeId: "r1", title: "Frittata", missing: [{ name: "Pomodori", productId: "p9", quantity: 100, unit: "g" }] },
      { recipeId: "r2", title: "Pasta", missing: [{ name: "Pomodori", productId: "p9", quantity: 200, unit: "g" }, { name: " " }] },
    ],
    [],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.quantity, 300);
  assert.equal(result[0]?.reason, "Per: Frittata, Pasta");
  assert.equal(result[0]?.sourceRef, "r1");
});

test("recipes: missing quantity defaults to one piece and listed items are skipped", () => {
  const result = deriveRecipeSuggestions(
    [{ recipeId: "r1", title: "X", missing: [{ name: "Basilico" }, { name: "Aglio" }] }],
    [{ displayName: "Aglio" }],
  );
  assert.deepEqual(result.map((s) => [s.label, s.quantity, s.unit]), [["Basilico", 1, "piece"]]);
});

test("offers: unnamed products are skipped and the best percentage wins", () => {
  const result = deriveOfferSuggestions(
    [
      { offerId: "o1", productId: "p1", storeName: "Coop", type: "percentage", value: 10, productName: "Latte" },
      { offerId: "o2", productId: "p1", storeName: "Conad", type: "percentage", value: 25, productName: "Latte" },
      { offerId: "o3", productId: "p2", storeName: "Coop", type: "fixed", value: 1.5 },
    ],
    [],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sourceRef, "o2");
  assert.equal(result[0]?.reason, "-25% da Conad");
});
