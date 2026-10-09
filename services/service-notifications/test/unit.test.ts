import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBoolean, isNotificationFamilyContext, validIdempotencyKey } from "../src/validation.js";
describe("notifications validation",()=>{
  it("validates preferences as booleans",()=>{assert.equal(isBoolean(true),true);assert.equal(isBoolean(false),true);assert.equal(isBoolean(1),false);});
  it("requires a family context",()=>{assert.equal(isNotificationFamilyContext("family-1"),true);assert.equal(isNotificationFamilyContext(""),false);});
  it("requires a stable idempotency key",()=>{assert.equal(validIdempotencyKey("12345678"),true);assert.equal(validIdempotencyKey("short"),false);});
});
