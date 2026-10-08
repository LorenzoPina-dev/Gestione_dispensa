ALTER TABLE recipe_catalog.recipe_ingredients
  ADD COLUMN IF NOT EXISTS canonical_ingredient varchar(200),
  ADD COLUMN IF NOT EXISTS semantic_confidence numeric(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ingredient_terms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quantity_value numeric(14,6),
  ADD COLUMN IF NOT EXISTS quantity_unit varchar(16),
  ADD COLUMN IF NOT EXISTS quantity_dimension varchar(16),
  ADD COLUMN IF NOT EXISTS quantity_base_value numeric(18,6),
  ADD COLUMN IF NOT EXISTS quantity_base_unit varchar(16),
  ADD COLUMN IF NOT EXISTS quantity_confidence numeric(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS culinary_weight varchar(16) NOT NULL DEFAULT 'CORE',
  ADD COLUMN IF NOT EXISTS prep_state varchar(64),
  ADD COLUMN IF NOT EXISTS source_quantity_raw varchar(128);

ALTER TABLE recipe_catalog.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_ingredients_quantity_dimension_ck;
ALTER TABLE recipe_catalog.recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_quantity_dimension_ck
  CHECK (quantity_dimension IS NULL OR quantity_dimension IN ('mass','volume','count'));

ALTER TABLE recipe_catalog.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_ingredients_quantity_base_unit_ck;
ALTER TABLE recipe_catalog.recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_quantity_base_unit_ck
  CHECK (quantity_base_unit IS NULL OR quantity_base_unit IN ('g','ml','piece'));

ALTER TABLE recipe_catalog.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_ingredients_culinary_weight_ck;
ALTER TABLE recipe_catalog.recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_culinary_weight_ck
  CHECK (culinary_weight IN ('STAPLE','SECONDARY','CORE'));

CREATE INDEX IF NOT EXISTS recipe_catalog_ingredient_canonical_idx
  ON recipe_catalog.recipe_ingredients(canonical_ingredient);
CREATE INDEX IF NOT EXISTS recipe_catalog_ingredient_terms_v2_idx
  ON recipe_catalog.recipe_ingredients USING gin(ingredient_terms);

ALTER TABLE recipes_domain.recipe_ingredients
  ADD COLUMN IF NOT EXISTS canonical_ingredient varchar(200),
  ADD COLUMN IF NOT EXISTS ingredient_terms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quantity_dimension varchar(16),
  ADD COLUMN IF NOT EXISTS quantity_base_value numeric(18,6),
  ADD COLUMN IF NOT EXISTS quantity_base_unit varchar(16),
  ADD COLUMN IF NOT EXISTS quantity_confidence numeric(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS culinary_weight varchar(16) NOT NULL DEFAULT 'CORE',
  ADD COLUMN IF NOT EXISTS prep_state varchar(64);

ALTER TABLE recipes_domain.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_domain_quantity_dimension_ck;
ALTER TABLE recipes_domain.recipe_ingredients
  ADD CONSTRAINT recipe_domain_quantity_dimension_ck
  CHECK (quantity_dimension IS NULL OR quantity_dimension IN ('mass','volume','count'));

ALTER TABLE recipes_domain.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_domain_quantity_base_unit_ck;
ALTER TABLE recipes_domain.recipe_ingredients
  ADD CONSTRAINT recipe_domain_quantity_base_unit_ck
  CHECK (quantity_base_unit IS NULL OR quantity_base_unit IN ('g','ml','piece'));

ALTER TABLE recipes_domain.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_domain_culinary_weight_ck;
ALTER TABLE recipes_domain.recipe_ingredients
  ADD CONSTRAINT recipe_domain_culinary_weight_ck
  CHECK (culinary_weight IN ('STAPLE','SECONDARY','CORE'));

CREATE INDEX IF NOT EXISTS recipe_domain_ingredient_canonical_idx
  ON recipes_domain.recipe_ingredients(canonical_ingredient);
CREATE INDEX IF NOT EXISTS recipe_domain_ingredient_terms_idx
  ON recipes_domain.recipe_ingredients USING gin(ingredient_terms);
