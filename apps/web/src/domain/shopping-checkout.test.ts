import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCheckoutPlan,
  canCompleteCheckout,
  initialPurchasedIds,
  labelsMatch,
  matchReceiptToList,
  type CheckoutListItem,
} from "./shopping-checkout.js";

const items: CheckoutListItem[] = [
  { id: "i1", displayName: "Latte", quantity: 2, unit: "piece", state: "COMPLETED" },
  { id: "i2", displayName: "Pomodori ciliegini", quantity: 500, unit: "g", state: "ACCEPTED", productId: "p2" },
  { id: "i3", displayName: "Olio EVO", quantity: 1, unit: "pz", state: "COMPLETED" },
];

test("receipt text matches list labels loosely", () => {
  assert.equal(labelsMatch("LATTE INTERO PARMALAT 1L", "Latte"), true);
  assert.equal(labelsMatch("Pomodoro ciliegino", "Pomodori ciliegini"), true);
  assert.equal(labelsMatch("Acqua naturale", "Latte"), false);
});

test("receipt lines match once, by product id first, and leftovers become extras", () => {
  const result = matchReceiptToList(
    [
      { name: "LATTE INTERO 1L", confidence: 0.9, priceMinor: 159, currency: "EUR" },
      { name: "SKU 123", confidence: 0.8, productId: "p2" },
      { name: "Acqua naturale 6x1,5L", confidence: 0.9, quantity: 1 },
    ],
    items,
  );
  assert.deepEqual(result.matches.map((m) => m.itemId), ["i1", "i2"]);
  assert.equal(result.extras.length, 1);
  assert.equal(result.extras[0]?.name, "Acqua naturale 6x1,5L");
});

test("items already in the cart start as purchased", () => {
  assert.deepEqual([...initialPurchasedIds(items)].sort(), ["i1", "i3"]);
});

test("plan loads purchased items and extras, removes bought, restores the rest", () => {
  const matches = matchReceiptToList([{ name: "Latte intero", confidence: 1, priceMinor: 159, currency: "EUR" }], items).matches;
  const plan = buildCheckoutPlan({
    items,
    purchasedIds: new Set(["i1"]),
    extras: [{ id: "x1", name: "  Acqua ", quantity: 1, unit: "pz" }, { id: "x2", name: "", quantity: 1, unit: "pz" }],
    receiptMatches: matches,
  });
  assert.deepEqual(plan.removeItemIds, ["i1"]);
  assert.deepEqual(plan.restoreItemIds, ["i3"]);
  assert.equal(plan.inPantryCount, 2);
  assert.equal(plan.staysInListCount, 2);
  assert.equal(plan.stockAdditions[0]?.priceMinor, 159);
  assert.equal(plan.stockAdditions[1]?.name, "Acqua");
  assert.equal(plan.stockAdditions[1]?.unit, "piece");
  assert.equal(canCompleteCheckout(plan), true);
});

test("an empty selection cannot complete", () => {
  const plan = buildCheckoutPlan({ items, purchasedIds: new Set(), extras: [] });
  assert.equal(canCompleteCheckout(plan), false);
  assert.deepEqual(plan.restoreItemIds, ["i1", "i3"]);
});
