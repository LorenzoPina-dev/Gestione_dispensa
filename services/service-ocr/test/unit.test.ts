import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isConfidence, isJobStatus, isJobType, isPositiveNumber } from "../src/validation.js";
describe("OCR validation",()=>{
  it("accepts only documented job types/statuses",()=>{assert.equal(isJobType("receipt"),true);assert.equal(isJobType("pantry_image"),true);assert.equal(isJobType("image"),false);assert.equal(isJobStatus("queued"),true);assert.equal(isJobStatus("needs_review"),true);assert.equal(isJobStatus("done"),false);});
  it("bounds confidence to 0..1",()=>{assert.equal(isConfidence(0),true);assert.equal(isConfidence(.94),true);assert.equal(isConfidence(1),true);assert.equal(isConfidence(-.1),false);assert.equal(isConfidence(1.1),false);});
  it("accepts only positive quantities",()=>{assert.equal(isPositiveNumber(1),true);assert.equal(isPositiveNumber(0),false);});
});
