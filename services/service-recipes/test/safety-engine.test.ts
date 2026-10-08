import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRecipeSafety } from "../src/safety-engine.js";

describe("recipe safety engine",()=>{
  it("blocks a known allergen in a recipe ingredient",()=>{
    const result=evaluateRecipeSafety([{name:"Latte",canonicalIngredient:"latte",ingredientTerms:["latte","milk"]}],[],{allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"WARN"});
    assert.equal(result.safe,false);
    assert.equal(result.warnings[0]?.severity,"BLOCK");
    assert.equal(result.warnings[0]?.code,"ALLERGEN");
  });
  it("blocks fish for vegetarian profiles but not for pescatarian profiles",()=>{
    const vegetarian=evaluateRecipeSafety([{name:"Tonno",canonicalIngredient:"tonno",ingredientTerms:["tonno","tuna"]}],[],{allergenTags:[],dietaryRestrictions:["vegetarian"],tracePolicy:"WARN"});
    const pescatarian=evaluateRecipeSafety([{name:"Tonno",canonicalIngredient:"tonno",ingredientTerms:["tonno","tuna"]}],[],{allergenTags:[],dietaryRestrictions:["pescatarian"],tracePolicy:"WARN"});
    assert.equal(vegetarian.safe,false);
    assert.equal(pescatarian.safe,true);
  });
  it("honors trace policy separately from direct allergens",()=>{
    const warn=evaluateRecipeSafety([], [{productId:"p1",name:"Product",foodSemantics:{allergenTags:[],traceTags:["milk"],canonicalIngredient:"farina"}}], {allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"WARN"});
    const exclude=evaluateRecipeSafety([], [{productId:"p1",name:"Product",foodSemantics:{allergenTags:[],traceTags:["milk"],canonicalIngredient:"farina"}}], {allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"EXCLUDE"});
    assert.equal(warn.safe,true);
    assert.equal(warn.warnings[0]?.code,"TRACE");
    assert.equal(exclude.safe,false);
  });
  it("does not turn unknown composition into a false safe claim",()=>{
    const result=evaluateRecipeSafety([{name:"Ingrediente sconosciuto"}],[],{allergenTags:["milk"],dietaryRestrictions:["vegan"],tracePolicy:"WARN"});
    assert.equal(result.safe,true);
    assert.equal(result.warnings[0]?.code,"UNKNOWN_COMPOSITION");
    assert.equal(result.warnings[0]?.severity,"WARN");
  });
});
