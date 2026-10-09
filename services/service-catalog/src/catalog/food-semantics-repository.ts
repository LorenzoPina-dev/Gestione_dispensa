import { deriveProductFoodSemantics, type ProductFoodSemantics } from "./food-semantics.js";
import type { SqlClient } from "./postgres.js";

type ResolverResponse = {
  status: "RESOLVED" | "UNRESOLVED";
  foodEntityId?: string | null;
  foodEntityAncestors?: string[];
  displayName?: string;
  semanticConfidence?: number;
  provenance?: string;
};

async function resolveProductIdentity(
  productId: string,
  canonicalName: string,
  snapshot: Record<string, unknown> | null | undefined,
): Promise<ResolverResponse | null> {
  let baseUrl = String(
    process.env.FOOD_SEMANTICS_SERVICE_BASE_URL ??
      "http://service-food-semantics:3410/api/v1",
  );
  while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
  const source = snapshot ?? {};
  const texts = [
    canonicalName,
    source.productName,
    source.productNameIt,
    source.productNameEn,
    source.productNameFr,
    source.productNameEs,
    source.productNameDe,
    source.ingredientsTextIt,
    source.ingredientsTextEn,
    source.ingredientsTextFr,
    source.ingredientsTextEs,
    source.ingredientsTextDe,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const taxonomyTags = [
    ...(Array.isArray(source.ingredientsTags) ? source.ingredientsTags : []),
    ...(Array.isArray(source.categoriesTags) ? source.categoriesTags : []),
    ...(Array.isArray(source.categoriesHierarchy) ? source.categoriesHierarchy : []),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!texts.length && !taxonomyTags.length) return null;

  try {
    const response = await fetch(baseUrl + "/resolve/product", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ productId, texts, taxonomyTags, locale: "it-IT" }),
      signal: AbortSignal.timeout(Number(process.env.FOOD_SEMANTICS_TIMEOUT_MS ?? 4000)),
    });
    if (!response.ok) return null;
    return await response.json() as ResolverResponse;
  } catch {
    return null;
  }
}

export async function upsertProductFoodSemantics(
  database: SqlClient,
  productId: string,
  canonicalName: string,
  snapshot: Record<string, unknown> | null | undefined,
  source?: string,
  sourceVersion?: string,
  observedAt = new Date(),
): Promise<ProductFoodSemantics> {
  const current = (!source || !sourceVersion)
    ? await database.query<{ source: string; source_version: string }>(
        "SELECT source,source_version FROM product_food_semantics WHERE product_id=$1",
        [productId],
      )
    : null;
  const effectiveSource = source ?? current?.rows[0]?.source ?? "derived";
  const effectiveSourceVersion = sourceVersion ?? current?.rows[0]?.source_version ?? "food-semantics-v2";
  const resolved = await resolveProductIdentity(productId, canonicalName, snapshot);
  const semantics = deriveProductFoodSemantics(productId, snapshot, canonicalName, effectiveSourceVersion, {
    foodEntityId: resolved?.foodEntityId ?? null,
    foodEntityAncestors: resolved?.foodEntityAncestors ?? [],
    semanticConfidence: Number(resolved?.semanticConfidence ?? 0),
    semanticStatus: resolved?.status === "RESOLVED" ? "EXACT" : undefined,
    provenance: resolved?.provenance ?? "food-semantics",
  });

  await database.query(
    `INSERT INTO product_food_semantics
      (product_id,canonical_ingredient,ingredient_terms,taxonomy_tags,allergen_tags,trace_tags,label_tags,dietary_tags,
       culinary_weight,quantity_value,quantity_unit,quantity_base_value,quantity_base_unit,quantity_confidence,
       semantic_confidence,semantic_status,source,source_version,observed_at,updated_at,components_json,composition_confidence,rules_version,nutriscore_grade)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,$20::jsonb,$21,$22,$23)
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
       rules_version=excluded.rules_version,
       nutriscore_grade=excluded.nutriscore_grade`,
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
      effectiveSource,
      semantics.sourceVersion,
      observedAt,
      JSON.stringify(semantics.components),
      semantics.compositionConfidence,
      semantics.rulesVersion,
      semantics.nutriScoreGrade,
    ],
  );
  return semantics;
}

export async function deleteProductFoodSemantics(database: SqlClient, productId: string): Promise<void> {
  await database.query("DELETE FROM product_food_semantics WHERE product_id=$1",[productId]);
}
