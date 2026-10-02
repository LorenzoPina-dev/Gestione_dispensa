import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isExpirationSource, positiveQuantity, requiredIdempotencyKey, validIfMatch } from "../src/validation.js";

describe("service-inventory / pure validation", () => {
  it("accepts positive integer and decimal quantities", () => {
    assert.equal(positiveQuantity(1), 1);
    assert.equal(positiveQuantity("2.5"), 2.5);
    assert.equal(positiveQuantity(" 3 "), 3);
  });

  it("rejects non-positive and non-finite quantities", () => {
    for (const value of [0, -1, "", "abc", Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      assert.equal(positiveQuantity(value), undefined);
    }
  });

  it("accepts only positive numeric If-Match versions", () => {
    for (const value of ["1", "2", "999"]) assert.equal(validIfMatch(value), true);
    for (const value of ["0", "-1", "1.5", "", "abc", " 1 "]) assert.equal(validIfMatch(value), false);
  });

  it("accepts exactly the two documented expiration sources", () => {
    assert.equal(isExpirationSource("declared"), true);
    assert.equal(isExpirationSource("estimated"), true);
    for (const value of ["", "Declared", "predicted", null, undefined, 1]) {
      assert.equal(isExpirationSource(value), false);
    }
  });

  it("requires a non-empty idempotency key", () => {
    assert.equal(requiredIdempotencyKey("key-1"), true);
    assert.equal(requiredIdempotencyKey("  key-1  "), true);
    assert.equal(requiredIdempotencyKey(""), false);
    assert.equal(requiredIdempotencyKey("   "), false);
  });
});
