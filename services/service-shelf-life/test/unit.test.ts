import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBoolean, isConfidence, isPredictionStatus, isStorage } from "../src/validation.js";
describe("shelf-life validation",()=>{
  it("uses the documented storage enum",()=>{for(const x of ["PANTRY","FRIDGE","FREEZER","CELLAR","OTHER"])assert.equal(isStorage(x),true);assert.equal(isStorage("REFRIGERATOR"),false);});
  it("bounds confidence",()=>{assert.equal(isConfidence(.81),true);assert.equal(isConfidence(1.1),false);});
  it("recognizes documented prediction states",()=>{for(const x of ["queued","completed","applied","superseded","failed"])assert.equal(isPredictionStatus(x),true);assert.equal(isPredictionStatus("processing"),false);});
  it("requires booleans for opened",()=>{assert.equal(isBoolean(true),true);assert.equal(isBoolean("true"),false);});
});
