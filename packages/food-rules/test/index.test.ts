import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalAllergenTag, canonicalizeIngredient, foodQuantity, foodSemanticRelation, inferTextAllergens, parseFoodCountFromText, parseIngredientText } from "../src/index.ts";

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
  it("parses countable ingredients with no explicit unit",()=>{
    assert.equal(parseFoodCountFromText("2 uova","uovo")?.baseValue,2);
    assert.equal(parseFoodCountFromText("3 onions","cipolla")?.baseValue,3);
    assert.equal(parseFoodCountFromText("2 pasta","pasta"),null);
  });
  it("keeps mass and volume as distinct dimensions",()=>{
    assert.equal(foodQuantity(1,"kg")?.baseUnit,"g");
    assert.equal(foodQuantity(1,"l")?.baseUnit,"ml");
  });
});
