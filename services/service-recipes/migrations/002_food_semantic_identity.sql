ALTER TABLE recipes_domain.recipe_ingredients
  ADD COLUMN IF NOT EXISTS display_name varchar(300),
  ADD COLUMN IF NOT EXISTS food_entity_id varchar(255),
  ADD COLUMN IF NOT EXISTS semantic_provenance varchar(64) NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS recipe_ingredients_food_entity_idx
  ON recipes_domain.recipe_ingredients(food_entity_id);
