import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCurrency, isNonNegativeInteger, isOfferType, isPositiveOffer, isValidDate } from "../src/validation.js";
describe("stores validation",()=>{
  it("enforces money in integer minor units",()=>{assert.equal(isNonNegativeInteger(0),true);assert.equal(isNonNegativeInteger(199),true);assert.equal(isNonNegativeInteger(1.5),false);assert.equal(isNonNegativeInteger(-1),false);});
  it("enforces ISO currency codes",()=>{assert.equal(isCurrency("EUR"),true);assert.equal(isCurrency("usd"),false);assert.equal(isCurrency("EURO"),false);});
  it("enforces offer types and positive values",()=>{assert.equal(isOfferType("percentage"),true);assert.equal(isOfferType("fixed"),true);assert.equal(isOfferType("free"),false);assert.equal(isPositiveOffer(20),true);assert.equal(isPositiveOffer(0),false);});
  it("rejects invalid timestamps",()=>{assert.equal(isValidDate("2026-10-02T00:00:00Z"),true);assert.equal(isValidDate("nope"),false);});
});
