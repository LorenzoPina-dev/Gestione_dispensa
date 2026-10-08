import { deriveProductFoodSemantics, type ProductFoodSemantics } from "./food-semantics.js";
import type { SqlClient } from "./postgres.js";

export async function upsertProductFoodSemantics(
  database: SqlClient,
  productId: string,
  canonicalName: string,
  snapshot: Record<string, unknown> | null | undefined,
  source: string,
  sourceVersion: string,
  observedAt = new Date(),
): Promise<ProductFoodSemantics> {
  const semantics = deriveProductFoodSemantics(productId, snapshot, canonicalName, sourceVersion);
  await database.query(
    `INSERT INTO product_food_semantics
      (product_id,canonical_ingredient,ingredient_terms,taxonomy_tags,allergen_tags,trace_tags,label_tags,dietary_tags,
       culinary_weight,quantity_value,quantity_unit,quantity_base_value,quantity_base_unit,quantity_confidence,
       semantic_confidence,semantic_status,source,source_version,observed_at,updated_at,components_json,composition_confidence,rules_version)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,$20::jsonb,$21,$22)
     ON CONFLICT(product_id) DO UPDATE SET
       canonical_ingredient=excluded.canonical_ingredient,
       ingredient_terms=excluded.ingredient_terms,
       taxonomy_tags=excluded.taxonomy_tags,
       allergen_tags=excluded.allergen_tags,
       trace_tags=excluded.trace_tags,
       label_tags=excluded.label_tags,
       dietary_tags=excluded.dietary_tags,
       culinary_weight=excluded.culinary_weight,
       quantity_value=excluded.quantity_value,
       quantity_unit=excluded.quantity_unit,
       quantity_base_value=excluded.quantity_base_value,
       quantity_base_unit=excluded.quantity_base_unit,
       quantity_confidence=excluded.quantity_confidence,
       semantic_confidence=excluded.semantic_confidence,
       semantic_status=excluded.semantic_status,
       source=excluded.source,
       source_version=excluded.source_version,
       observed_at=excluded.observed_at,
       updated_at=now(),
       components_json=excluded.components_json,
       composition_confidence=excluded.composition_confidence,
       rules_version=excluded.rules_version`,
    [
      productId,
      semantics.canonicalIngredient,
      semantics.ingredientTerms,
      semantics.taxonomyTags,
      semantics.allergenTags,
      semantics.traceTags,
      semantics.labelTags,
      semantics.dietaryTags,
      semantics.culinaryWeight,
      semantics.quantity?.value ?? null,
      semantics.quantity?.unit ?? null,
      semantics.quantityBase?.value ?? null,
      semantics.quantityBase?.unit ?? null,
      semantics.quantityConfidence,
      semantics.semanticConfidence,
      semantics.semanticStatus,
      source,
      semantics.sourceVersion,
      observedAt,
      JSON.stringify(semantics.components),
      semantics.compositionConfidence,
      semantics.rulesVersion,
    ],
  );
  return semantics;
}

export async function deleteProductFoodSemantics(database: SqlClient, productId: string): Promise<void> {
  await database.query("DELETE FROM product_food_semantics WHERE product_id=$1",[productId]);
}
