import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeDietaryPreferences } from "../src/dietary-preferences.js";

describe("dietary preferences",()=>{
  it("normalizes language aliases and OFF-style allergen tags",()=>{
    const result=normalizeDietaryPreferences({allergenTags:["en:milk","arachidi"],dietaryRestrictions:["senza glutine","Vegan"],tracePolicy:"EXCLUDE",uncertaintyPolicy:"WARN"});
    assert.deepEqual(result.issues,[]);
    assert.deepEqual(result.value?.allergenTags,["milk","peanuts"]);
    assert.deepEqual(result.value?.dietaryRestrictions,["gluten-free","vegan"]);
    assert.equal(result.value?.tracePolicy,"EXCLUDE");
    assert.equal(result.value?.uncertaintyPolicy,"WARN");
  });
  it("rejects unknown safety values instead of storing no-op policies",()=>{
    const result=normalizeDietaryPreferences({allergenTags:["something-unknown"],dietaryRestrictions:["keto"]});
    assert.equal(result.value,undefined);
    assert.equal(result.issues.length,2);
  });
});

describe("dietary preferences / uncertainty",()=>{
  it("defaults uncertainty handling to EXCLUDE",()=>{
    const result=normalizeDietaryPreferences({allergenTags:[],dietaryRestrictions:[]});
    assert.equal(result.issues.length,0);
    assert.equal(result.value?.uncertaintyPolicy,"EXCLUDE");
  });

  it("accepts explicit WARN only when requested",()=>{
    const result=normalizeDietaryPreferences({allergenTags:[],dietaryRestrictions:[],uncertaintyPolicy:"WARN"});
    assert.equal(result.issues.length,0);
    assert.equal(result.value?.uncertaintyPolicy,"WARN");
  });
});
