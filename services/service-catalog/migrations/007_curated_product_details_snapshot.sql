-- Replace the provider-document copy in Catalog with a bounded application snapshot.
-- OFF remains the complete provider source in off-lookup; Catalog stores only fields the product UI/domain currently consumes.
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_details_snapshot jsonb NULL;

UPDATE products
SET product_details_snapshot = jsonb_strip_nulls(jsonb_build_object(
  'ingredientsText', openfoodfacts_raw->'ingredients_text',
  'ingredientsTextIt', openfoodfacts_raw->'ingredients_text_it',
  'allergensTags', openfoodfacts_raw->'allergens_tags',
  'tracesTags', openfoodfacts_raw->'traces_tags',
  'labelsTags', openfoodfacts_raw->'labels_tags',
  'categoriesTags', openfoodfacts_raw->'categories_tags',
  'countriesTags', openfoodfacts_raw->'countries_tags',
  'storesTags', openfoodfacts_raw->'stores_tags',
  'packaging', openfoodfacts_raw->'packaging',
  'origins', openfoodfacts_raw->'origins',
  'nutriScoreGrade', openfoodfacts_raw->'nutriscore_grade',
  'novaGroup', openfoodfacts_raw->'nova_group',
  'ecoScoreGrade', openfoodfacts_raw->'ecoscore_grade'
))
WHERE product_details_snapshot IS NULL
  AND openfoodfacts_raw IS NOT NULL;

ALTER TABLE products DROP COLUMN IF EXISTS openfoodfacts_raw;

INSERT INTO schema_migrations(version) VALUES ('007_curated_product_details_snapshot')
ON CONFLICT DO NOTHING;
