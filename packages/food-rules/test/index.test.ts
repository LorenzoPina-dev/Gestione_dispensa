import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalAllergenTag, canonicalizeIngredient, convertFoodQuantityWithDensity, foodQuantity, inferTextAllergens, parseFoodCountFromText, parseFoodQuantityFromText, parseIngredientText } from "../src/index.ts";

describe("food-rules",()=>{
  it("does not canonicalize substrings such as salted -> sale",()=>{
    const result=canonicalizeIngredient("salted crackers");
    assert.notEqual(result.canonicalIngredient,"sale");
  });
  it("treats malformed runtime text as empty instead of throwing",()=>{
    assert.equal(canonicalizeIngredient(undefined as unknown as string).canonicalIngredient,null);
  });
  it("keeps food identity unresolved without the semantic resolver",()=>{
    const result=canonicalizeIngredient("Blue Cheese");
    assert.equal(result.canonicalIngredient,"blue cheese");
    assert.equal(result.status,"AMBIGUOUS");
    assert.ok(result.confidence < 0.8);
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
  it("normalizes multipack quantities into total content",()=>{
    const parsed=parseFoodQuantityFromText("2 x 180 g");
    assert.ok(parsed);
    assert.equal(parsed.baseValue,360);
    assert.equal(parsed.baseUnit,"g");
    assert.equal(parsed.sourceRaw,"2 x 180 g");
  });
  it("supports the multiplication sign used on commercial pack labels",()=>{
    const parsed=parseFoodQuantityFromText("6×100 ml");
    assert.ok(parsed);
    assert.equal(parsed.baseValue,600);
    assert.equal(parsed.baseUnit,"ml");
  });
  it("parses nested ingredient components with provenance",()=>{
    const parsed=parseIngredientText("pesto (basilico, 30% parmigiano, olio extravergine)");
    assert.equal(parsed.length,4);
    assert.equal(parsed[1]?.role,"SUBCOMPONENT");
    assert.equal(parsed[1]?.parentCanonicalIngredient,"pesto");
    assert.equal(parsed[1]?.provenance,"ingredients_text");
    assert.equal(parsed[2]?.percentage,30);
  });
  it("converts only ingredients with a versioned density rule",()=>{
    const converted=convertFoodQuantityWithDensity(100,"ml","latte","g");
    assert.ok(converted);
    assert.equal(converted.baseUnit,"g");
    assert.equal(converted.baseValue,103);
    assert.equal(convertFoodQuantityWithDensity(100,"ml","farina","g"),null);
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

describe("food-rules / structured ingredient lines",()=>{
  it("extracts explicit quantity and preparation state",()=>{
    const parsed=parseFoodIngredientLine("2 large eggs, beaten");
    assert.equal(parsed.quantity?.baseValue,2);
    assert.equal(parsed.quantity?.baseUnit,"piece");
    assert.equal(parsed.ingredientText.includes("eggs"),true);
    assert.equal(parsed.prepState,"beaten");
  });

  it("extracts multilingual preparation state",()=>{
    const parsed=parseFoodIngredientLine("250 g farina, setacciata");
    assert.equal(parsed.quantity?.baseValue,250);
    assert.equal(parsed.quantity?.baseUnit,"g");
    assert.equal(parsed.prepState,"setacciata");
  });

  it("does not invent a quantity from an ambiguous range",()=>{
    const parsed=parseFoodIngredientLine("200-250 g flour");
    assert.equal(parsed.quantity,null);
  });
});

describe("food-rules / nested compound components",()=>{
  it("preserves the primary product and exposes nested components with paths",()=>{
    const result=parseIngredientText("pesto (basilico, parmigiano, olio extravergine)");
    assert.equal(result[0]?.canonicalIngredient,"pesto");
    assert.equal(result[0]?.role,"PRIMARY");
    assert.equal(result[0]?.depth,0);
    assert.equal(result[0]?.path,"0");
    const nested=result.filter(item=>item.role==="SUBCOMPONENT");
    assert.equal(nested.length,3);
    assert.equal(nested[0]?.canonicalIngredient,"basilico");
    assert.equal(nested[0]?.parentCanonicalIngredient,"pesto");
    assert.equal(nested[0]?.path,"0.0");
    assert.equal(nested[1]?.canonicalIngredient,"parmigiano");
    assert.equal(nested[1]?.path,"0.1");
  });
});
