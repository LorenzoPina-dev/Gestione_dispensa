import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isShoppingUnit, normalizeListName, parseIfMatch, positiveQuantity, validFamilyId, validIdempotencyKey } from "../src/validation.js";

describe("service-shopping / pure validation", () => {
  it("normalizes list names", () => {
    assert.equal(normalizeListName("  Spesa  "), "Spesa");
    assert.equal(normalizeListName(null), "");
    assert.equal(normalizeListName(42), "");
  });

  it("accepts only positive finite quantities", () => {
    assert.equal(positiveQuantity(1), 1);
    assert.equal(positiveQuantity("2.5"), 2.5);
    for (const value of [0, -1, "", "abc", Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      assert.equal(positiveQuantity(value), undefined);
    }
  });

  it("validates documented units", () => {
    for (const unit of ["g", "kg", "ml", "l", "piece", "pack"]) assert.equal(isShoppingUnit(unit), true);
    for (const unit of ["", "pcs", "meter", null, undefined]) assert.equal(isShoppingUnit(unit), false);
    assert.equal(isShoppingUnit("L"), true);
  });

  it("requires an idempotency key of at least eight characters", () => {
    assert.equal(validIdempotencyKey("12345678"), true);
    assert.equal(validIdempotencyKey("1234567"), false);
  });

  it("parses optimistic-lock versions", () => {
    for (const value of ["1", "42", "version-7", 'W/"3"', '"4"']) assert.ok(parseIfMatch(value));
    for (const value of ["0", "-1", "1.5", "version-0", "abc", "", "W/abc"]) assert.equal(parseIfMatch(value), undefined);
  });

  it("requires a non-empty family id", () => {
    assert.equal(validFamilyId("family-1"), true);
    assert.equal(validFamilyId(""), false);
    assert.equal(validFamilyId(null), false);
  });
});
