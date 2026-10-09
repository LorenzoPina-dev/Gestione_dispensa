import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateFamilySafetyProfiles } from "../src/family-safety-profile.js";

describe("family safety aggregation",()=>{
  it("unions allergens and dietary restrictions and chooses the strictest trace policy",()=>{
    const result=aggregateFamilySafetyProfiles(["u1","u2"],[
      {userId:"u1",exists:true,allergenTags:["milk"],dietaryRestrictions:["vegetarian"],tracePolicy:"WARN",uncertaintyPolicy:"WARN"},
      {userId:"u2",exists:true,allergenTags:["peanuts"],dietaryRestrictions:["gluten-free"],tracePolicy:"EXCLUDE",uncertaintyPolicy:"EXCLUDE"},
    ]);
    assert.deepEqual(result.allergenTags.sort(),["milk","peanuts"]);
    assert.deepEqual(result.dietaryRestrictions.sort(),["gluten-free","vegetarian"]);
    assert.equal(result.tracePolicy,"EXCLUDE");
    assert.equal(result.uncertaintyPolicy,"EXCLUDE");
    assert.equal(result.complete,true);
  });
  it("does not treat a missing member preference as an empty safe profile",()=>{
    const result=aggregateFamilySafetyProfiles(["u1","u2"],[
      {userId:"u1",exists:true,allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"WARN"},
    ]);
    assert.equal(result.complete,false);
    assert.deepEqual(result.missingPreferenceUserIds,["u2"]);
  });
});
