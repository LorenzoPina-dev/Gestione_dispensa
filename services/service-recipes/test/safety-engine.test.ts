import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRecipeSafety } from "../src/safety-engine.js";

describe("recipe safety engine",()=>{
  it("blocks a known allergen in a recipe ingredient",()=>{
    const result=evaluateRecipeSafety([{name:"Latte",canonicalIngredient:"latte",ingredientTerms:["latte","milk"]}],[],{allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"WARN",uncertaintyPolicy:"EXCLUDE"});
    assert.equal(result.safe,false);
    assert.equal(result.warnings[0]?.severity,"BLOCK");
    assert.equal(result.warnings[0]?.code,"ALLERGEN");
  });
  it("blocks fish for vegetarian profiles but not for pescatarian profiles",()=>{
    const vegetarian=evaluateRecipeSafety([{name:"Tonno",canonicalIngredient:"tonno",ingredientTerms:["tonno","tuna"]}],[],{allergenTags:[],dietaryRestrictions:["vegetarian"],tracePolicy:"WARN",uncertaintyPolicy:"EXCLUDE"});
    const pescatarian=evaluateRecipeSafety([{name:"Tonno",canonicalIngredient:"tonno",ingredientTerms:["tonno","tuna"]}],[],{allergenTags:[],dietaryRestrictions:["pescatarian"],tracePolicy:"WARN",uncertaintyPolicy:"EXCLUDE"});
    assert.equal(vegetarian.safe,false);
    assert.equal(pescatarian.safe,true);
  });
  it("honors trace policy separately from direct allergens",()=>{
    const warn=evaluateRecipeSafety([], [{productId:"p1",name:"Product",foodSemantics:{allergenTags:[],traceTags:["milk"],canonicalIngredient:"farina"}}], {allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"WARN",uncertaintyPolicy:"EXCLUDE"});
    const exclude=evaluateRecipeSafety([], [{productId:"p1",name:"Product",foodSemantics:{allergenTags:[],traceTags:["milk"],canonicalIngredient:"farina"}}], {allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"EXCLUDE",uncertaintyPolicy:"EXCLUDE"});
    assert.equal(warn.safe,true);
    assert.equal(warn.warnings[0]?.code,"TRACE");
    assert.equal(exclude.safe,false);
  });
  it("uses concrete product safety facts instead of a generic recipe ingredient inference",()=>{
    const result=evaluateRecipeSafety(
      [{name:"Formaggio",canonicalIngredient:"formaggio",ingredientTerms:["formaggio","cheese"],matchedProductIds:["p1"]}],
      [{productId:"p1",name:"Formaggio vegetale",foodSemantics:{canonicalIngredient:"formaggio",allergenTags:[],traceTags:[],components:[],compositionConfidence:1}}],
      {allergenTags:["milk"],dietaryRestrictions:["vegan"],tracePolicy:"WARN",uncertaintyPolicy:"EXCLUDE"},
    );
    assert.equal(result.safe,true);
    assert.equal(result.warnings.length,0);
  });

  it("blocks allergens inferred from a compound pantry product composition",()=>{
    const result=evaluateRecipeSafety([], [{productId:"p1",name:"Pesto",foodSemantics:{allergenTags:[],traceTags:[],canonicalIngredient:"pesto",components:[{canonicalIngredient:"formaggio",ingredientTerms:["formaggio","cheese"]}],compositionConfidence:1}}], {allergenTags:["milk"],dietaryRestrictions:[],tracePolicy:"WARN",uncertaintyPolicy:"EXCLUDE"});
    assert.equal(result.safe,false);
    assert.equal(result.warnings[0]?.code,"ALLERGEN");
  });
  it("does not turn unknown composition into a false safe claim",()=>{
    const result=evaluateRecipeSafety([{name:"Ingrediente sconosciuto"}],[],{allergenTags:["milk"],dietaryRestrictions:["vegan"],tracePolicy:"WARN",uncertaintyPolicy:"EXCLUDE"});
    assert.equal(result.safe,false);
    assert.equal(result.warnings[0]?.code,"UNKNOWN_COMPOSITION");
    assert.equal(result.warnings[0]?.severity,"BLOCK");
  });
});
