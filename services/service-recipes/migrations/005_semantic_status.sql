ALTER TABLE recipe_catalog.recipe_ingredients
  ADD COLUMN IF NOT EXISTS semantic_status varchar(16) NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE recipe_catalog.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_catalog_ingredient_status_check;
ALTER TABLE recipe_catalog.recipe_ingredients
  ADD CONSTRAINT recipe_catalog_ingredient_status_check
  CHECK (semantic_status IN ('EXACT','INFERRED','UNKNOWN','AMBIGUOUS'));

ALTER TABLE recipes_domain.recipe_ingredients
  ADD COLUMN IF NOT EXISTS semantic_status varchar(16) NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE recipes_domain.recipe_ingredients
  DROP CONSTRAINT IF EXISTS recipe_domain_ingredient_status_check;
ALTER TABLE recipes_domain.recipe_ingredients
  ADD CONSTRAINT recipe_domain_ingredient_status_check
  CHECK (semantic_status IN ('EXACT','INFERRED','UNKNOWN','AMBIGUOUS'));
