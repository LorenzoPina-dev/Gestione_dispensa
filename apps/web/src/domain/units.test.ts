import assert from "node:assert/strict";
import test from "node:test";
import {
  convertQuantity,
  formatQuantity,
  formatUnit,
  normalizeUnit,
  quantityStep,
  roundUpToStep,
} from "./units.js";

test("legacy and Italian spellings normalize to backend units", () => {
  assert.equal(normalizeUnit("pz"), "piece");
  assert.equal(normalizeUnit(" Litri "), "l");
  assert.equal(normalizeUnit("conf."), "pack");
  assert.equal(normalizeUnit("KG"), "kg");
});

test("unknown units fall back to a countable unit instead of an invalid one", () => {
  assert.equal(normalizeUnit("bottiglia"), "piece");
  assert.equal(normalizeUnit(undefined), "piece");
  assert.equal(normalizeUnit("mazzo", "pack"), "pack");
});

test("conversion stays inside a family and never converts countables", () => {
  assert.equal(convertQuantity(1, "kg", "g"), 1000);
  assert.equal(convertQuantity(250, "ml", "l"), 0.25);
  assert.equal(convertQuantity(2, "g", "g"), 2);
  assert.equal(convertQuantity(1, "g", "ml"), null);
  assert.equal(convertQuantity(1, "piece", "pack"), null);
});

test("quantity steps and rounding", () => {
  assert.equal(quantityStep("piece"), 1);
  assert.equal(quantityStep("g"), 100);
  assert.equal(roundUpToStep(150, "g"), 200);
  assert.equal(roundUpToStep(0, "piece"), 1);
  assert.equal(roundUpToStep(0.2, "kg"), 0.5);
});

test("display helpers", () => {
  assert.equal(formatUnit("piece"), "pz");
  assert.equal(formatUnit("pack"), "conf.");
  assert.equal(formatUnit("g"), "g");
  assert.equal(formatUnit("bottiglia"), "bottiglia");
  assert.equal(formatQuantity(1.5), "1,5");
  assert.equal(formatQuantity(3), "3");
});
