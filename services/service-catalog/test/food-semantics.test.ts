import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveProductFoodSemantics } from "../src/catalog/food-semantics.js";

describe("catalog food semantics",()=>{
  it("prefers explicit OFF ingredient tags over product-name ambiguity",()=>{
    const result=deriveProductFoodSemantics(
      "p1",
      { ingredients_tags:["it:farina"], ingredients_text:"farina di grano" },
      "Brand Special",
      "off-api-v3",
    );
    assert.equal(result.canonicalIngredient,"farina");
    assert.equal(result.semanticStatus,"EXACT");
    assert.equal(result.sourceVersion,"off-api-v3");
    assert.equal(result.rulesVersion,"food-semantics-v2");
  });

  it("uses a single recognized ingredients_text component as a conservative inferred identity",()=>{
    const result=deriveProductFoodSemantics(
      "p2",
      { ingredients_text:"latte" },
      "Mystery Product",
      "off-api-v3",
    );
    assert.equal(result.canonicalIngredient,"latte");
    assert.equal(result.semanticStatus,"INFERRED");
    assert.ok(result.semanticConfidence < 0.9);
    assert.equal(result.components[0]?.canonicalIngredient,"latte");
  });

  it("does not collapse a compound product into one ingredient",()=>{
    const result=deriveProductFoodSemantics(
      "p3",
      { ingredients_text:"basilico, olio extravergine, parmigiano" },
      "Pesto",
      "off-api-v3",
    );
    assert.equal(result.canonicalIngredient,"pesto");
    assert.equal(result.semanticStatus,"EXACT");
    assert.equal(result.components.length,3);
    assert.equal(result.compositionConfidence,1);
  });

  it("falls back to taxonomy only after name and ingredient text remain unresolved",()=>{
    const result=deriveProductFoodSemantics(
      "p4",
      { categories_tags:["en:milk"] },
      "Unknown Brand Product",
      "off-api-v3",
    );
    assert.equal(result.canonicalIngredient,"latte");
    assert.equal(result.semanticStatus,"EXACT");
  });

  it("keeps Nutri-Score separate from food identity",()=>{
    const result=deriveProductFoodSemantics(
      "p5",
      { nutriscore_grade:"B", categories_tags:["en:pasta"] },
      "Pasta",
      "off-api-v3",
    );
    assert.equal(result.nutriScoreGrade,"b");
    assert.equal(result.canonicalIngredient,"pasta");
  });
});
