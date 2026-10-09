CREATE OR REPLACE FUNCTION public.product_food_semantics_json(p_product_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'productId', p.product_id,
    'canonicalIngredient', p.canonical_ingredient,
    'ingredientTerms', p.ingredient_terms,
    'taxonomyTags', p.taxonomy_tags,
    'allergenTags', p.allergen_tags,
    'traceTags', p.trace_tags,
    'labelTags', p.label_tags,
    'dietaryTags', p.dietary_tags,
    'culinaryWeight', p.culinary_weight,
    'quantity', CASE
      WHEN p.quantity_value IS NULL THEN NULL
      ELSE jsonb_build_object('value', p.quantity_value, 'unit', p.quantity_unit)
    END,
    'quantityBase', CASE
      WHEN p.quantity_base_value IS NULL THEN NULL
      ELSE jsonb_build_object('value', p.quantity_base_value, 'unit', p.quantity_base_unit)
    END,
    'quantityConfidence', p.quantity_confidence,
    'semanticConfidence', p.semantic_confidence,
    'semanticStatus', p.semantic_status,
    'components', p.components_json,
    'compositionConfidence', p.composition_confidence,
    'source', p.source,
    'sourceVersion', p.source_version,
    'rulesVersion', p.rules_version,
    'nutriScoreGrade', p.nutriscore_grade,
    'observedAt', p.observed_at
  )
  FROM public.product_food_semantics p
  WHERE p.product_id = p_product_id
$$;
