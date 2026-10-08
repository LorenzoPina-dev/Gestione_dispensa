import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { averageNutriScore, scoreRecipeAgainstPantry } from "../src/pantry-recipe-engine.js";
import { foodQuantity } from "@gestione-dispensa/food-rules";
import { combineInventoryQuantity, parseQuantityFromText, quantityCoverage } from "../src/quantity-engine.js";

describe("pantry-recipe-engine", () => {
  it("matches Italian and English ingredient names through canonical semantics", () => {
    const result=scoreRecipeAgainstPantry(
      [{name:"flour",displayName:"flour",canonicalIngredient:"farina",ingredientTerms:["flour","farina"],culinaryWeight:"CORE",quantityValue:500,quantityUnit:"g",quantityDimension:"mass",quantityBaseValue:500,quantityBaseUnit:"g",quantityConfidence:1}],
      [{productId:"p1",name:"Farina 00",quantity:0.5,unit:"kg",foodSemantics:{canonicalIngredient:"farina",ingredientTerms:["farina","flour"],taxonomyTags:["flour"],quantityBase:{value:500,unit:"g"}}}],
    );
    assert.equal(result.score,1);
    assert.equal(result.readiness,"READY");
    assert.deepEqual(result.matchedProductIds,["p1"]);
  });

  it("converts package stock to mass only when package quantity is explicitly known", () => {
    const packaged=combineInventoryQuantity(2,"pack",{value:180,unit:"g"});
    assert.ok(packaged);
    assert.equal(packaged.baseValue,360);
    const required=foodQuantity(300,"g");
    assert.ok(required);
    const coverage=quantityCoverage(
      {value:required.value,unit:required.unit,dimension:required.dimension,baseValue:required.baseValue,baseUnit:required.baseUnit,confidence:1,sourceRaw:required.sourceRaw},
      [packaged],
    );
    assert.equal(coverage.status,"COMPLETE");
    assert.equal(coverage.ratio,1);
  });

  it("does not silently convert incompatible units", () => {
    const result=scoreRecipeAgainstPantry(
      [{name:"latte",displayName:"latte",canonicalIngredient:"latte",culinaryWeight:"CORE",quantityValue:2,quantityUnit:"l",quantityDimension:"volume",quantityBaseValue:2000,quantityBaseUnit:"ml",quantityConfidence:1}],
      [{productId:"p1",name:"Latte",quantity:500,unit:"g",foodSemantics:{canonicalIngredient:"latte",ingredientTerms:["latte","milk"]}}],
    );
    assert.equal(result.score,0);
    assert.equal(result.missingIngredients[0]?.status,"INCOMPATIBLE");
  });

  it("applies STAPLE 0.1 and CORE 1.0 weights to the main score", () => {
    const result=scoreRecipeAgainstPantry(
      [
        {name:"pasta",displayName:"pasta",canonicalIngredient:"pasta",culinaryWeight:"CORE"},
        {name:"sale",displayName:"sale",canonicalIngredient:"sale",culinaryWeight:"STAPLE"},
      ],
      [{productId:"p1",name:"Pasta",quantity:500,unit:"g",foodSemantics:{canonicalIngredient:"pasta",ingredientTerms:["pasta"]}}],
    );
    assert.equal(result.score,0.9091);
    assert.equal(result.readiness,"READY");
    assert.equal(result.missingCoreCount,0);
  });

  it("uses partial quantity coverage rather than binary presence", () => {
    const result=scoreRecipeAgainstPantry(
      [{name:"farina",displayName:"farina",canonicalIngredient:"farina",culinaryWeight:"CORE",quantityValue:1000,quantityUnit:"g",quantityDimension:"mass",quantityBaseValue:1000,quantityBaseUnit:"g",quantityConfidence:1}],
      [{productId:"p1",name:"Farina",quantity:400,unit:"g",foodSemantics:{canonicalIngredient:"farina",ingredientTerms:["farina"]}}],
    );
    assert.equal(result.score,0.4);
    assert.equal(result.readiness,"DISCARD");
    assert.equal(result.missingIngredients[0]?.status,"PARTIAL");
  });

  it("calculates an ingredient-level Nutri-Score average only from matched pantry products",()=>{
    const result=averageNutriScore(
      [
        {productId:"a",name:"A",quantity:1,unit:"piece",foodSemantics:{canonicalIngredient:"pasta",nutriScoreGrade:"a"}},
        {productId:"b",name:"B",quantity:1,unit:"piece",foodSemantics:{canonicalIngredient:"formaggio",nutriScoreGrade:"e"}},
        {productId:"c",name:"C",quantity:1,unit:"piece",foodSemantics:{canonicalIngredient:"sale",nutriScoreGrade:null}},
      ],
      ["a","b","c"],
    );
    assert.equal(result.average,3);
    assert.equal(result.coverage,0.667);
  });

  it("uses a curated functional substitute with an 0.8 score factor", () => {
    const result = scoreRecipeAgainstPantry(
      [{ name:"parmigiano", displayName:"parmigiano", canonicalIngredient:"parmigiano", culinaryWeight:"CORE", quantityValue:100, quantityUnit:"g", quantityDimension:"mass", quantityBaseValue:100, quantityBaseUnit:"g", quantityConfidence:1 }],
      [{ productId:"p1", name:"Pecorino", quantity:100, unit:"g", foodSemantics:{ canonicalIngredient:"pecorino", ingredientTerms:["pecorino"], taxonomyTags:[], quantityBase:{value:100,unit:"g"} } }],
    );
    assert.equal(result.score,0.8);
    assert.equal(result.readiness,"READY");
    assert.equal(result.substitutions[0]?.factor,0.8);
  });

  it("parses common kitchen quantities without turning unknown text into a fact", () => {
    const parsed=parseQuantityFromText("1/2 kg");
    assert.ok(parsed);
    assert.equal(parsed.baseValue,500);
  });
});
