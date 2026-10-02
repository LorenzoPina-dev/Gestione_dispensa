import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDiarySource, isDiaryUnit, isNonNegativeNumber, isPositiveNumber, isSummaryPeriod, validIfMatch } from "../src/validation.js";

describe("nutrition validation", () => {
  it("accepts only non-negative numeric targets", () => {
    for (const v of [0, 1, 2200, 1.5]) assert.equal(isNonNegativeNumber(v), true);
    for (const v of [-1, "1", NaN, Infinity, null, undefined]) assert.equal(isNonNegativeNumber(v), false);
  });
  it("accepts only positive diary quantities", () => {
    assert.equal(isPositiveNumber(1), true);
    assert.equal(isPositiveNumber(0), false);
    assert.equal(isPositiveNumber(-1), false);
  });
  it("restricts diary units and sources to the documented enum", () => {
    assert.equal(isDiaryUnit("g"), true);
    assert.equal(isDiaryUnit("kg"), true);
    assert.equal(isDiaryUnit("l"), false);
    assert.equal(isDiarySource("manual"), true);
    assert.equal(isDiarySource("inventory"), true);
    assert.equal(isDiarySource("catalog"), false);
  });
  it("accepts only today/week summary periods", () => {
    assert.equal(isSummaryPeriod("today"), true);
    assert.equal(isSummaryPeriod("week"), true);
    assert.equal(isSummaryPeriod("month"), false);
  });
  it("parses optimistic lock versions", () => {
    assert.equal(validIfMatch("1"), true);
    assert.equal(validIfMatch('W/"2"'), true);
    assert.equal(validIfMatch("0"), false);
    assert.equal(validIfMatch("abc"), false);
  });
});
