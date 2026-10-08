import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalAllergenTag, canonicalizeIngredient, foodQuantity, foodSemanticRelation, inferTextAllergens, parseFoodCountFromText, parseFoodQuantityFromText, parseIngredientText } from "../src/index.ts";

describe("food-rules",()=>{
  it("does not canonicalize substrings such as salted -> sale",()=>{
    const result=canonicalizeIngredient("salted crackers");
    assert.notEqual(result.canonicalIngredient,"sale");
  });
  it("canonicalizes multilingual ingredient names",()=>{
    assert.equal(canonicalizeIngredient("farine").canonicalIngredient,"farina");
    assert.equal(canonicalizeIngredient("lait").canonicalIngredient,"latte");
    assert.equal(canonicalizeIngredient("pollo").canonicalIngredient,"pollo");
  });
  it("canonicalizes language-prefixed allergen tags",()=>{
    assert.equal(canonicalAllergenTag("en:tree-nuts"),"nuts");
    assert.equal(canonicalAllergenTag("it:latte"),"milk");
  });
  it("parses compound ingredients without losing unknown components",()=>{
    const result=parseIngredientText("pomodoro 30%, basilico, ingrediente non riconosciuto");
    assert.equal(result[0]?.canonicalIngredient,"pomodoro");
    assert.equal(result[0]?.percentage,30);
    assert.equal(result[2]?.canonicalIngredient,null);
  });
  it("allows a generic recipe ingredient to use a specific child ingredient",()=>{
    const relation = foodSemanticRelation("formaggio","mozzarella");
    assert.equal(relation,"RECIPE_GENERALIZES_PRODUCT");
  });
  it("does not allow a generic pantry category to satisfy a specific recipe ingredient",()=>{
    const relation = foodSemanticRelation("parmigiano","formaggio");
    assert.equal(relation,"UNSAFE_GENERALIZATION");
  });
  it("infers allergens from multilingual ingredient text even when canonicalization is unknown",()=>{
    assert.ok(inferTextAllergens("soy sauce").includes("soybeans"));
    assert.ok(inferTextAllergens("beurre et lait").includes("milk"));
    assert.ok(inferTextAllergens("crevettes").includes("crustaceans"));
  });
  it("normalizes Italian kitchen volume units",()=>{
    assert.equal(parseFoodQuantityFromText("1 cucchiaino").baseUnit,"ml");
    assert.equal(parseFoodQuantityFromText("2 cucchiai").baseUnit,"ml");
  });
  it("rejects numeric quantity ranges until the range model is supported",()=>{
    assert.equal(parseFoodQuantityFromText("100-120 g"),null);
    assert.equal(parseFoodQuantityFromText("100 to 120 g"),null);
  });
  it("parses countable ingredients with no explicit unit",()=>{
    assert.equal(parseFoodCountFromText("2 uova","uovo")?.baseValue,2);
    assert.equal(parseFoodCountFromText("3 onions","cipolla")?.baseValue,3);
    assert.equal(parseFoodCountFromText("2 pasta","pasta"),null);
  });
  it("separates direct allergen text from trace statements",()=>{
    const direct=inferTextSafetyFacts("Ingredients: milk, flour");
    assert.ok(direct.allergens.includes("milk"));
    const trace=inferTextSafetyFacts("May contain milk and nuts");
    assert.ok(trace.traceAllergens.includes("milk"));
    assert.ok(trace.traceAllergens.includes("nuts"));
    assert.equal(trace.allergens.includes("milk"),false);
  });
  it("does not turn explicit allergen absence into a positive allergen fact",()=>{
    const result=inferTextSafetyFacts("Senza latte e senza arachidi");
    assert.ok(result.explicitlyAbsent.includes("milk"));
    assert.ok(result.explicitlyAbsent.includes("peanuts"));
    assert.equal(result.allergens.length,0);
  });

  it("keeps mass and volume as distinct dimensions",()=>{
    assert.equal(foodQuantity(1,"kg")?.baseUnit,"g");
    assert.equal(foodQuantity(1,"l")?.baseUnit,"ml");
  });
});
