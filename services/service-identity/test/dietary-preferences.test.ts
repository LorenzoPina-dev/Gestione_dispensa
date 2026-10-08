import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeDietaryPreferences } from "../src/dietary-preferences.js";

describe("dietary preferences",()=>{
  it("normalizes language aliases and OFF-style allergen tags",()=>{
    const result=normalizeDietaryPreferences({allergenTags:["en:milk","arachidi"],dietaryRestrictions:["senza glutine","Vegan"],tracePolicy:"EXCLUDE"});
    assert.deepEqual(result.issues,[]);
    assert.deepEqual(result.value?.allergenTags,["milk","peanuts"]);
    assert.deepEqual(result.value?.dietaryRestrictions,["gluten-free","vegan"]);
    assert.equal(result.value?.tracePolicy,"EXCLUDE");
  });
  it("rejects unknown safety values instead of storing no-op policies",()=>{
    const result=normalizeDietaryPreferences({allergenTags:["something-unknown"],dietaryRestrictions:["keto"]});
    assert.equal(result.value,undefined);
    assert.equal(result.issues.length,2);
  });
});
