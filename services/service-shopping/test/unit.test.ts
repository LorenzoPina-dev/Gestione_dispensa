import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOptionalUuid, isShoppingSource, isShoppingUnit, normalizeListName, parseIfMatch, positiveQuantity, validFamilyId, validIdempotencyKey } from "../src/validation.js";

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

  it("accepts only the documented item sources", () => {
    for (const source of ["manual", "recipe", "low_stock", "offer"]) assert.equal(isShoppingSource(source), true);
    for (const source of ["", "Manual", "reorder", 1, null, undefined]) assert.equal(isShoppingSource(source), false);
  });

  it("accepts a product reference only when absent, null or a UUID", () => {
    for (const value of [undefined, null, "3f2b8c1e-5d4a-4b7e-9c1d-0a1b2c3d4e5f"]) assert.equal(isOptionalUuid(value), true);
    for (const value of ["", "abc", "not-a-uuid", 12]) assert.equal(isOptionalUuid(value), false);
  });
});
